import { Queue } from 'bullmq';
import { getRedis } from '../redis';

export interface MonitoringJobData {
  userId: string;
  entityAbn: string;
  entityName: string;
  subscriptionId: string;
}

const QUEUE_NAME = 'monitoring';

let _queue: Queue<MonitoringJobData> | null = null;

export function getMonitoringQueue(): Queue<MonitoringJobData> {
  if (!_queue) {
    _queue = new Queue<MonitoringJobData>(QUEUE_NAME, {
      connection: getRedis(),
      defaultJobOptions: {
        attempts: 3,
        backoff: { type: 'exponential', delay: 5000 },
        removeOnComplete: { age: 86400 },   // keep completed jobs 24h for inspection
        removeOnFail: { age: 604800 },      // keep failed jobs 7 days (dead-letter)
      },
    });
  }
  return _queue;
}

export async function enqueueMonitoringJob(
  data: MonitoringJobData,
  opts?: { delay?: number; jobId?: string }
): Promise<void> {
  await getMonitoringQueue().add('run-check', data, {
    delay: opts?.delay,
    jobId: opts?.jobId,
  });
}

const DAY_MS = 24 * 60 * 60 * 1000;

export async function enqueueInitialMonitoringJobs(data: MonitoringJobData): Promise<void> {
  await Promise.all([
    enqueueMonitoringJob(data, { delay: DAY_MS, jobId: `${data.subscriptionId}-daily` }),
    enqueueMonitoringJob(data, { delay: 7 * DAY_MS, jobId: `${data.subscriptionId}-weekly` }),
    enqueueMonitoringJob(data, { delay: 30 * DAY_MS, jobId: `${data.subscriptionId}-monthly` }),
  ]);
}
