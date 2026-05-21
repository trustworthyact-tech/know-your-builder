/**
 * Email sequence worker — run with: npm run worker:emailSequence
 * (from the web/ directory, with REDIS_URL, DATABASE_URL, NEXTAUTH_URL, RESEND_API_KEY set)
 *
 * Uses a dedicated Redis connection (separate from the Queue connection in
 * lib/queues/emailSequence.ts) because BullMQ workers issue blocking BLPOP
 * commands that must not share a connection with Queue's non-blocking commands.
 */

import { Worker, Job } from 'bullmq';
import { PrismaClient } from '@prisma/client';
import Redis from 'ioredis';
import { Resend } from 'resend';
import { render } from '@react-email/components';
import {
  type EmailSequenceJobData,
  type SequenceKey,
  SEQUENCE_DEFS,
  getEmailSequenceQueue,
} from '../lib/queues/emailSequence';
import { BeforeYouSign } from '../emails/BeforeYouSign';
import { DuringBuild } from '../emails/DuringBuild';
import { SubcontractorOnboarding } from '../emails/SubcontractorOnboarding';
import { FindingsAlert } from '../emails/FindingsAlert';
import { CleanReport } from '../emails/CleanReport';
import { ReEngagement } from '../emails/ReEngagement';
import { RecheckReminder } from '../emails/RecheckReminder';
import { PaymentDueReminder } from '../emails/PaymentDueReminder';
import type { RiskGroupResult } from '../src/types';

const prisma = new PrismaClient();

const connection = new Redis(process.env.REDIS_URL ?? 'redis://localhost:6379', {
  maxRetriesPerRequest: null,
});

const resend = process.env.RESEND_API_KEY ? new Resend(process.env.RESEND_API_KEY) : null;

const APP_URL = process.env.NEXTAUTH_URL ?? 'http://localhost:3000';
const FROM_EMAIL = process.env.FROM_EMAIL ?? 'noreply@knowyourbuilder.com.au';

// ─── Email renderer ───────────────────────────────────────────────────────────

interface EmailContext {
  entityName: string;
  entityAbn: string;
  reportUrl: string;
  monitoringUrl: string;
  sequenceKey: SequenceKey;
  step: number;
  persona?: string | null;
  riskGroups: { label: string; description: string }[];
  milestoneLabel?: string;
  milestoneDateFormatted?: string;
  amountFormatted?: string;
}

async function renderStepEmail(ctx: EmailContext): Promise<string> {
  const {
    entityName, entityAbn, reportUrl, monitoringUrl, sequenceKey, step, persona, riskGroups,
    milestoneLabel, milestoneDateFormatted, amountFormatted,
  } = ctx;
  const abn = entityAbn || undefined;

  switch (sequenceKey) {
    case 'BEFORE_SIGN':
      return render(BeforeYouSign({ entityName, entityAbn: abn, reportUrl, step }));
    case 'DURING_BUILD':
      return render(DuringBuild({ entityName, entityAbn: abn, reportUrl, monitoringUrl, step }));
    case 'SUBCONTRACTOR':
      return render(SubcontractorOnboarding({ entityName, entityAbn: abn, reportUrl }));
    case 'FINDINGS':
      return render(FindingsAlert({ entityName, entityAbn: abn, reportUrl, riskGroups }));
    case 'CLEAN':
      return render(CleanReport({ entityName, entityAbn: abn, reportUrl, persona: persona ?? undefined }));
    case 'REENGAGEMENT':
      return render(ReEngagement({ entityName, entityAbn: abn, reportUrl }));
    case 'RECHECK_30D':
      return render(RecheckReminder({ entityName, entityAbn: abn, reportUrl, dayCount: 30 }));
    case 'RECHECK_90D':
      return render(RecheckReminder({ entityName, entityAbn: abn, reportUrl, dayCount: 90 }));
    case 'PAYMENT_DUE':
      return render(PaymentDueReminder({
        entityName,
        entityAbn: abn,
        reportUrl,
        milestoneLabel: milestoneLabel ?? 'Upcoming payment',
        milestoneDateFormatted: milestoneDateFormatted ?? '',
        amountFormatted: amountFormatted ?? '',
      }));
  }
}

// ─── Job processor ────────────────────────────────────────────────────────────

async function processJob(job: Job<EmailSequenceJobData>): Promise<void> {
  const { sequenceStateId, userId, searchId, sequenceKey, step } = job.data;
  console.log(`[emailSequence] Job ${job.id}: ${sequenceKey} step ${step} for user ${userId}`);

  // Load state row; bail if already completed or step has moved on (deduplication guard)
  const state = await prisma.emailSequenceState.findUnique({
    where: { id: sequenceStateId },
    select: { step: true, completed: true },
  });
  if (!state || state.completed || state.step !== step) {
    console.log(`[emailSequence] Job ${job.id}: stale or completed — skipping`);
    return;
  }

  // Load user email
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { email: true },
  });
  if (!user?.email) {
    console.log(`[emailSequence] Job ${job.id}: no email for user ${userId} — skipping`);
    return;
  }

  // Load entity context from the associated search (best-effort)
  let entityName = '';
  let entityAbn = '';
  let persona: string | null = null;
  let riskGroups: { label: string; description: string }[] = [];
  if (searchId) {
    const search = await prisma.search.findUnique({
      where: { id: searchId },
      select: { entityName: true, entityAbn: true, persona: true, riskSummary: true },
    });
    entityName = search?.entityName ?? '';
    entityAbn = search?.entityAbn ?? '';
    persona = search?.persona ?? null;
    if (search?.riskSummary) {
      try {
        const parsed = JSON.parse(search.riskSummary) as RiskGroupResult[];
        riskGroups = parsed.map((g) => ({ label: g.label, description: g.description }));
      } catch {
        // riskSummary parse failure is non-fatal
      }
    }
  }

  const reportUrl = searchId ? `${APP_URL}/report/${searchId}` : APP_URL;
  const monitoringUrl = `${APP_URL}/account/monitoring`;
  const stepDef = SEQUENCE_DEFS[sequenceKey][step];

  // For PAYMENT_DUE, look up the next upcoming milestone from the project timeline
  let milestoneLabel: string | undefined;
  let milestoneDateFormatted: string | undefined;
  let amountFormatted: string | undefined;
  if (sequenceKey === 'PAYMENT_DUE' && searchId) {
    try {
      const timeline = await prisma.projectTimeline.findUnique({
        where: { searchId },
        select: { paymentSchedule: true },
      });
      if (timeline?.paymentSchedule) {
        const schedule = timeline.paymentSchedule as Array<{
          label: string;
          date: string;
          amountCents: number;
        }>;
        const now = new Date();
        const upcoming = schedule
          .filter((e) => new Date(e.date) > now)
          .sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime())[0];
        if (upcoming) {
          milestoneLabel = upcoming.label;
          milestoneDateFormatted = new Date(upcoming.date).toLocaleDateString('en-AU', {
            day: 'numeric',
            month: 'long',
            year: 'numeric',
          });
          amountFormatted = `$${(upcoming.amountCents / 100).toLocaleString('en-AU')}`;
        }
      }
    } catch (err) {
      console.error(`[emailSequence] PAYMENT_DUE timeline lookup error for job ${job.id}:`, err);
    }
  }

  // Send email — best-effort, never fail the job on email error
  if (resend) {
    try {
      const html = await renderStepEmail({
        entityName, entityAbn, reportUrl, monitoringUrl, sequenceKey, step, persona, riskGroups,
        milestoneLabel, milestoneDateFormatted, amountFormatted,
      });
      await resend.emails.send({
        from: FROM_EMAIL,
        to: user.email,
        subject: stepDef.subject,
        html,
      });
      console.log(`[emailSequence] Email sent to ${user.email}: "${stepDef.subject}"`);
    } catch (err) {
      console.error(`[emailSequence] Email send error for job ${job.id}:`, err);
    }
  } else {
    console.log(`[emailSequence] RESEND_API_KEY not set — skipping email send for job ${job.id}`);
  }

  // Advance to next step or mark complete
  const nextStep = step + 1;
  const hasNextStep = nextStep < SEQUENCE_DEFS[sequenceKey].length;

  if (hasNextStep && stepDef.nextStepDelayMs !== undefined) {
    const nextDelay = stepDef.nextStepDelayMs;
    const nextSendAt = new Date(Date.now() + nextDelay);

    await prisma.emailSequenceState.update({
      where: { id: sequenceStateId },
      data: { step: nextStep, nextSendAt },
    });

    await getEmailSequenceQueue().add(
      'send-step',
      { sequenceStateId, userId, searchId, sequenceKey, step: nextStep },
      { delay: nextDelay, jobId: `${sequenceStateId}-step-${nextStep}` },
    );

    console.log(`[emailSequence] Step ${nextStep} scheduled in ${nextDelay / 3600000}h for state ${sequenceStateId}`);
  } else {
    await prisma.emailSequenceState.update({
      where: { id: sequenceStateId },
      data: { completed: true },
    });
    console.log(`[emailSequence] Sequence ${sequenceKey} completed for state ${sequenceStateId}`);
  }
}

// ─── Worker ───────────────────────────────────────────────────────────────────

const worker = new Worker<EmailSequenceJobData>('email-sequence', processJob, {
  connection,
  concurrency: 4,
});

worker.on('completed', (job) => {
  console.log(`[emailSequence] Job ${job.id} completed`);
});

worker.on('failed', (job, err) => {
  console.error(`[emailSequence] Job ${job?.id} failed (attempt ${job?.attemptsMade}):`, err.message);
});

worker.on('error', (err) => {
  console.error('[emailSequence] Worker connection error:', err);
});

console.log('[emailSequence] Worker started, listening for jobs…');

process.on('SIGTERM', async () => {
  console.log('[emailSequence] SIGTERM — draining worker');
  await worker.close();
  await prisma.$disconnect();
  connection.disconnect();
});
