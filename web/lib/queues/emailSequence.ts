import { Queue } from 'bullmq';
import { getRedis } from '../redis';
import { prisma } from '../db';

export type SequenceKey =
  | 'BEFORE_SIGN'
  | 'DURING_BUILD'
  | 'SUBCONTRACTOR'
  | 'FINDINGS'
  | 'CLEAN'
  | 'REENGAGEMENT'
  | 'RECHECK_30D'
  | 'RECHECK_90D'
  | 'PAYMENT_DUE';

export interface EmailSequenceJobData {
  sequenceStateId: string;
  userId: string;
  searchId: string | null;
  sequenceKey: SequenceKey;
  step: number;
}

// Each step carries the email subject and how long to delay before the NEXT step.
// The delay before step 0 is handled at enqueue time via SEQUENCE_FIRST_DELAY.
export interface StepDef {
  subject: string;
  nextStepDelayMs?: number; // undefined on the last step
}

const DAY_MS = 24 * 60 * 60 * 1000;

export const SEQUENCE_DEFS: Record<SequenceKey, StepDef[]> = {
  BEFORE_SIGN: [
    { subject: 'Before you sign — your builder due diligence summary', nextStepDelayMs: 3 * DAY_MS },
    { subject: '3-day reminder — share your builder report before signing' },
  ],
  DURING_BUILD: [
    { subject: 'Builder confirmed — here\'s what to monitor during your build', nextStepDelayMs: 30 * DAY_MS },
    { subject: '30-day build check-in — re-check your builder?' },
  ],
  SUBCONTRACTOR: [
    { subject: 'Subcontractor due diligence complete — next steps' },
  ],
  FINDINGS: [
    { subject: 'Important findings on your builder search — action recommended' },
  ],
  CLEAN: [
    { subject: 'All clear — your builder checks out' },
  ],
  REENGAGEMENT: [
    { subject: 'Did you find the right builder? — Know Your Builder' },
  ],
  RECHECK_30D: [
    { subject: 'Time for a 30-day re-check — Know Your Builder' },
  ],
  RECHECK_90D: [
    { subject: 'Time for a 90-day re-check — Know Your Builder' },
  ],
  PAYMENT_DUE: [
    { subject: 'Payment milestone coming up — Know Your Builder' },
  ],
};

// Delay before step 0 fires (most sequences are immediate).
export const SEQUENCE_FIRST_DELAY: Record<SequenceKey, number> = {
  BEFORE_SIGN:   0,
  DURING_BUILD:  0,
  SUBCONTRACTOR: 0,
  FINDINGS:      0,
  CLEAN:         0,
  REENGAGEMENT:  14 * DAY_MS,
  RECHECK_30D:   30 * DAY_MS,
  RECHECK_90D:   90 * DAY_MS,
  PAYMENT_DUE:   0,
};

const QUEUE_NAME = 'email-sequence';

let _queue: Queue<EmailSequenceJobData> | null = null;

export function getEmailSequenceQueue(): Queue<EmailSequenceJobData> {
  if (!_queue) {
    _queue = new Queue<EmailSequenceJobData>(QUEUE_NAME, {
      connection: getRedis(),
      defaultJobOptions: {
        attempts: 3,
        backoff: { type: 'exponential', delay: 5000 },
        removeOnComplete: { age: 86400 },
        removeOnFail: { age: 604800 },
      },
    });
  }
  return _queue;
}

export async function enqueueSequence(
  userId: string,
  searchId: string | null,
  sequenceKey: SequenceKey,
  opts?: { initialDelay?: number },
): Promise<void> {
  // Idempotency: skip if an active sequence of this type already exists for this user+search.
  const existing = await prisma.emailSequenceState.findFirst({
    where: { userId, searchId: searchId ?? null, sequenceKey, completed: false },
    select: { id: true },
  });
  if (existing) return;

  const delay = opts?.initialDelay ?? SEQUENCE_FIRST_DELAY[sequenceKey];
  const nextSendAt = new Date(Date.now() + delay);

  const state = await prisma.emailSequenceState.create({
    data: { userId, searchId, sequenceKey, step: 0, nextSendAt, completed: false },
  });

  await getEmailSequenceQueue().add(
    'send-step',
    { sequenceStateId: state.id, userId, searchId, sequenceKey, step: 0 },
    { delay, jobId: `${state.id}-step-0` },
  );
}
