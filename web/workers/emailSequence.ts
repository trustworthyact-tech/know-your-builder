/**
 * Email sequence worker — run with: npm run worker:emailSequence
 * (from the web/ directory, with REDIS_URL, DATABASE_URL, NEXTAUTH_URL, RESEND_API_KEY set)
 *
 * Uses a dedicated Redis connection (separate from the Queue connection in
 * lib/queues/emailSequence.ts) because BullMQ workers issue blocking BLPOP
 * commands that must not share a connection with Queue's non-blocking commands.
 *
 * Phase 9c: email body is rendered as simple HTML inline.
 * Phase 9d will replace renderStepEmail() with proper React Email template imports.
 */

import { Worker, Job } from 'bullmq';
import { PrismaClient } from '@prisma/client';
import Redis from 'ioredis';
import { Resend } from 'resend';
import {
  type EmailSequenceJobData,
  type SequenceKey,
  SEQUENCE_DEFS,
  getEmailSequenceQueue,
} from '../lib/queues/emailSequence';

const prisma = new PrismaClient();

const connection = new Redis(process.env.REDIS_URL ?? 'redis://localhost:6379', {
  maxRetriesPerRequest: null,
});

const resend = process.env.RESEND_API_KEY ? new Resend(process.env.RESEND_API_KEY) : null;

const APP_URL = process.env.NEXTAUTH_URL ?? 'http://localhost:3000';
const FROM_EMAIL = process.env.FROM_EMAIL ?? 'noreply@knowyourbuilder.com.au';

// ─── Email renderer ───────────────────────────────────────────────────────────
// Phase 9c: simple inline HTML per sequence type.
// Phase 9d replaces this with React Email renders (import BeforeYouSign, etc.).

interface EmailContext {
  entityName: string;
  entityAbn: string;
  reportUrl: string;
  sequenceKey: SequenceKey;
  step: number;
}

const bodies: Partial<Record<SequenceKey, string[]>> = {
  BEFORE_SIGN: [
    '<p>You recently ran a due diligence search on this builder. Before you sign any contract, share the report with your solicitor or building inspector.</p>',
    '<p>A quick reminder — your Know Your Builder report is still available. Review it before you sign.',
  ],
  DURING_BUILD: [
    '<p>Your builder check is on record. Consider setting up ongoing monitoring so you\'re alerted to any changes — licence suspensions, insolvency notices, or new court decisions — during your build.</p>',
    '<p>It\'s been 30 days since your build started. A lot can change — consider running a re-check to confirm everything is still in order.</p>',
  ],
  SUBCONTRACTOR: [
    '<p>Your subcontractor due diligence check is complete. Keep this report on file and consider checking the builder\'s QBCC licence before each payment stage.</p>',
  ],
  FINDINGS: [
    '<p>Your search returned findings that warrant further review. We recommend you read the full report and, where relevant, seek legal or financial advice before proceeding.</p>',
  ],
  CLEAN: [
    '<p>Great news — your search returned no significant findings. Keep this report on file, and consider re-checking closer to the contract signing date if some time has passed.</p>',
  ],
  REENGAGEMENT: [
    '<p>It\'s been two weeks since your builder search. Have you made a decision? Your report is still available whenever you need it.</p>',
  ],
  RECHECK_30D: [
    '<p>It\'s been 30 days since your last builder check. Builder circumstances can change — licences can be suspended, insolvency notices filed. A quick re-check takes under a minute.</p>',
  ],
  RECHECK_90D: [
    '<p>90 days have passed since your last builder check. Now is a good time to re-run due diligence before any upcoming payment milestones.</p>',
  ],
  PAYMENT_DUE: [
    '<p>A payment milestone is coming up. Before releasing funds, consider running a quick re-check to confirm your builder\'s licence is still current and no new notices have been filed.</p>',
  ],
};

function renderStepEmail(ctx: EmailContext): string {
  const { entityName, entityAbn, reportUrl, sequenceKey, step } = ctx;
  const entityLabel = entityAbn ? `${entityName} (ABN&nbsp;${entityAbn})` : entityName;
  const bodyHtml =
    bodies[sequenceKey]?.[step] ??
    `<p>Your Know Your Builder report is ready. <a href="${reportUrl}">View report →</a></p>`;

  return `<!DOCTYPE html>
<html lang="en">
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif;background:#F4F6F9;margin:0;padding:0">
  <div style="max-width:560px;margin:32px auto;padding:0 16px">
    <div style="background:#1A3A5C;border-radius:12px 12px 0 0;padding:24px 32px;text-align:center">
      <p style="color:#fff;font-size:18px;font-weight:700;margin:0">Know Your Builder</p>
      <p style="color:rgba(255,255,255,0.65);font-size:12px;margin:4px 0 0">Automated due diligence</p>
    </div>
    <div style="background:#fff;border:1px solid #D1D9E0;border-top:none;padding:24px 32px">
      <p style="color:#9AA5B4;font-size:11px;font-weight:600;letter-spacing:0.5px;text-transform:uppercase;margin:0 0 4px">REPORT FOR</p>
      <p style="color:#1A3A5C;font-size:18px;font-weight:700;margin:0 0 16px">${entityLabel}</p>
      ${bodyHtml}
      <div style="margin-top:24px;text-align:center">
        <a href="${reportUrl}" style="background:#1A3A5C;border-radius:12px;color:#fff;display:inline-block;font-size:14px;font-weight:600;padding:14px 32px;text-decoration:none">
          View Full Report →
        </a>
      </div>
    </div>
    <div style="padding:16px 0;text-align:center">
      <p style="color:#9AA5B4;font-size:11px;margin:0">© Know Your Builder · Automated due diligence for Australian construction</p>
    </div>
  </div>
</body>
</html>`;
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
  if (searchId) {
    const search = await prisma.search.findUnique({
      where: { id: searchId },
      select: { entityName: true, entityAbn: true },
    });
    entityName = search?.entityName ?? '';
    entityAbn = search?.entityAbn ?? '';
  }

  const reportUrl = searchId ? `${APP_URL}/report/${searchId}` : APP_URL;
  const stepDef = SEQUENCE_DEFS[sequenceKey][step];

  // Send email — best-effort, never fail the job on email error
  if (resend) {
    try {
      const html = renderStepEmail({ entityName, entityAbn, reportUrl, sequenceKey, step });
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
