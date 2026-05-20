/**
 * Monitoring worker — run with: npx tsx workers/monitoring.ts
 * (from the web/ directory, with REDIS_URL, DATABASE_URL, SCRAPING_SERVICE_URL set)
 *
 * Uses a dedicated Redis connection (separate from the Queue connection in lib/queues/monitoring.ts)
 * because BullMQ workers issue blocking BLPOP commands that must not share a connection
 * with Queue's non-blocking commands.
 */

import { Worker, Job } from 'bullmq';
import { PrismaClient, AlertType } from '@prisma/client';
import Redis from 'ioredis';
import { Resend } from 'resend';
import { render } from '@react-email/components';
import { WatchlistAlert } from '../emails/WatchlistAlert';
import type { MonitoringJobData } from '../lib/queues/monitoring';

const prisma = new PrismaClient();

const connection = new Redis(process.env.REDIS_URL ?? 'redis://localhost:6379', {
  maxRetriesPerRequest: null,
});

const resend = process.env.RESEND_API_KEY ? new Resend(process.env.RESEND_API_KEY) : null;

const EXPRESS_URL = process.env.SCRAPING_SERVICE_URL ?? 'http://localhost:3001';

// ─── Local types (mirror web/src/types/index.ts shapes we care about) ─────────

interface ResultItem {
  title: string;
  url?: string;
  description?: string;
  status?: string;
  metadata?: Record<string, string>;
}

interface SearchResult {
  key: string;
  status: string;
  results?: ResultItem[];
  licenceResults?: ResultItem[];
  adjudicationResults?: ResultItem[];
}

// ─── Search runner ────────────────────────────────────────────────────────────

async function runSearch(entityName: string, entityAbn: string): Promise<Record<string, SearchResult>> {
  const response = await fetch(`${EXPRESS_URL}/api/search`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ companyName: entityName, abn: entityAbn }),
  });

  if (!response.ok) throw new Error(`Express returned ${response.status}`);
  if (!response.body) throw new Error('Response body is null');

  const findings: Record<string, SearchResult> = {};
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split('\n');
    buffer = lines.pop() ?? '';
    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      try {
        const result = JSON.parse(trimmed) as SearchResult;
        findings[result.key] = result;
      } catch {
        // malformed NDJSON line — skip
      }
    }
  }

  return findings;
}

// ─── Diff engine ──────────────────────────────────────────────────────────────

const AUSTLII_KEYS = [
  'austlii_federal', 'austlii_qld', 'austlii_nsw', 'austlii_vic',
  'austlii_wa', 'austlii_sa', 'austlii_nt', 'austlii_act', 'austlii_tas',
];

function detectChanges(
  newF: Record<string, SearchResult>,
  oldF: Record<string, SearchResult>,
): { alertType: AlertType; description: string }[] {
  const alerts: { alertType: AlertType; description: string }[] = [];

  // QBCC licence count or status change
  const newLic = newF.qbcc?.licenceResults ?? [];
  const oldLic = oldF.qbcc?.licenceResults ?? [];
  if (newLic.length !== oldLic.length) {
    alerts.push({
      alertType: AlertType.LICENCE_CHANGE,
      description: `QBCC licence count changed from ${oldLic.length} to ${newLic.length}`,
    });
  } else if (newLic.length > 0) {
    const sig = (items: ResultItem[]) =>
      items.map((r) => r.status ?? '').sort().join('|');
    if (sig(newLic) !== sig(oldLic)) {
      alerts.push({
        alertType: AlertType.LICENCE_CHANGE,
        description: 'QBCC licence status change detected',
      });
    }
  }

  // QBCC adjudication — new decisions
  const newAdj = newF.qbcc?.adjudicationResults ?? [];
  const oldAdj = oldF.qbcc?.adjudicationResults ?? [];
  if (newAdj.length > oldAdj.length) {
    alerts.push({
      alertType: AlertType.QBCC_ADJUDICATION,
      description: `${newAdj.length - oldAdj.length} new QBCC adjudication decision(s) detected`,
    });
  }

  // ASIC insolvency notices
  const newIns = newF.asicInsolvency?.results ?? [];
  const oldIns = oldF.asicInsolvency?.results ?? [];
  if (newIns.length > oldIns.length) {
    alerts.push({
      alertType: AlertType.INSOLVENCY_EVENT,
      description: `${newIns.length - oldIns.length} new ASIC insolvency notice(s) detected`,
    });
  }

  // ATO tax debt disclosures
  const newAto = newF.atoDebt?.results ?? [];
  const oldAto = oldF.atoDebt?.results ?? [];
  if (newAto.length > oldAto.length) {
    alerts.push({
      alertType: AlertType.ATO_DEBT_FLAG,
      description: `${newAto.length - oldAto.length} new ATO tax debt disclosure(s) detected`,
    });
  }

  // Court/tribunal decisions across all AustLII jurisdictions
  const sumResults = (f: Record<string, SearchResult>, keys: string[]) =>
    keys.reduce((n, k) => n + (f[k]?.results?.length ?? 0), 0);
  const newCourt = sumResults(newF, AUSTLII_KEYS);
  const oldCourt = sumResults(oldF, AUSTLII_KEYS);
  if (newCourt > oldCourt) {
    alerts.push({
      alertType: AlertType.COURT_DECISION,
      description: `${newCourt - oldCourt} new court or tribunal decision(s) detected across all jurisdictions`,
    });
  }

  // Fair Work Ombudsman enforcement outcomes
  const newFwo = newF.fwo?.results ?? [];
  const oldFwo = oldF.fwo?.results ?? [];
  if (newFwo.length > oldFwo.length) {
    alerts.push({
      alertType: AlertType.FWO_ENFORCEMENT,
      description: `${newFwo.length - oldFwo.length} new Fair Work Ombudsman enforcement outcome(s) detected`,
    });
  }

  return alerts;
}

// ─── Job processor ────────────────────────────────────────────────────────────

async function processJob(job: Job<MonitoringJobData>): Promise<void> {
  const { userId, entityAbn, entityName, subscriptionId } = job.data;
  console.log(`[monitoring] Processing job ${job.id} for ${entityName} (${entityAbn})`);

  // Bail early if subscription was cancelled between enqueue and now
  const subscription = await prisma.monitoringSubscription.findUnique({
    where: { id: subscriptionId },
    select: { active: true },
  });
  if (!subscription?.active) {
    console.log(`[monitoring] Subscription ${subscriptionId} is inactive — skipping`);
    return;
  }

  // Find the most recent prior search to diff against
  const priorSearch = await prisma.search.findFirst({
    where: entityAbn ? { userId, entityAbn } : { userId, entityName },
    orderBy: { createdAt: 'desc' },
    select: { id: true, reportJson: true },
  });

  // Run fresh search
  const newFindings = await runSearch(entityName, entityAbn);

  // Persist as a new Search row so future runs can diff against it
  await prisma.search.create({
    data: {
      userId,
      entityName,
      entityAbn: entityAbn || null,
      reportJson: newFindings as object,
    },
  });

  // No prior report — this run establishes the baseline; no alerts yet
  if (!priorSearch?.reportJson) {
    console.log(`[monitoring] Baseline established for ${entityName} (no prior report to diff)`);
    return;
  }

  const priorFindings = priorSearch.reportJson as unknown as Record<string, SearchResult>;
  const changes = detectChanges(newFindings, priorFindings);

  if (changes.length === 0) {
    console.log(`[monitoring] No changes detected for ${entityName}`);
    return;
  }

  await prisma.alert.createMany({
    data: changes.map((c) => ({
      userId,
      entityAbn,
      entityName,
      alertType: c.alertType,
      description: c.description,
      read: false,
    })),
  });

  console.log(`[monitoring] ${changes.length} alert(s) created for ${entityName}`);

  // Send alert email — best-effort, never fail the job if email fails
  if (resend) {
    try {
      const user = await prisma.user.findUnique({
        where: { id: userId },
        select: { email: true },
      });

      if (user?.email) {
        const appUrl = process.env.NEXTAUTH_URL ?? 'http://localhost:3000';
        const params = new URLSearchParams({ companyName: entityName });
        if (entityAbn) params.set('abn', entityAbn);
        const reRunUrl = `${appUrl}/search?${params.toString()}`;

        const html = await render(
          WatchlistAlert({
            entityName,
            entityAbn,
            alerts: changes.map((c) => ({ alertType: c.alertType, description: c.description })),
            reRunUrl,
          })
        );

        await resend.emails.send({
          from: process.env.FROM_EMAIL ?? 'noreply@knowyourbuilder.com.au',
          to: user.email,
          subject: `Monitoring alert — ${entityName}`,
          html,
        });

        console.log(`[monitoring] Alert email sent to ${user.email} for ${entityName}`);
      }
    } catch (err) {
      console.error('[monitoring] Alert email send error:', err);
    }
  }
}

// ─── Worker ───────────────────────────────────────────────────────────────────

const worker = new Worker<MonitoringJobData>('monitoring', processJob, {
  connection,
  concurrency: 2,
});

worker.on('completed', (job) => {
  console.log(`[monitoring] Job ${job.id} completed`);
});

worker.on('failed', (job, err) => {
  // BullMQ moves the job to the failed set after all retries are exhausted.
  // The worker process itself does not crash — errors are contained per-job.
  console.error(`[monitoring] Job ${job?.id} failed (attempt ${job?.attemptsMade}):`, err.message);
});

worker.on('error', (err) => {
  console.error('[monitoring] Worker connection error:', err);
});

console.log('[monitoring] Worker started, listening for jobs…');

process.on('SIGTERM', async () => {
  console.log('[monitoring] SIGTERM — draining worker');
  await worker.close();
  await prisma.$disconnect();
  connection.disconnect();
});
