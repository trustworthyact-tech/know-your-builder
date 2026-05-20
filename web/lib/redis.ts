import Redis from 'ioredis';

const globalForRedis = globalThis as unknown as { redis?: Redis };

// maxRetriesPerRequest must be null for BullMQ Queue connections (non-blocking commands).
// Worker connections are created separately in workers/ with the same setting.
export function getRedis(): Redis {
  if (!globalForRedis.redis) {
    globalForRedis.redis = new Redis(process.env.REDIS_URL ?? 'redis://localhost:6379', {
      maxRetriesPerRequest: null,
    });
  }
  return globalForRedis.redis;
}
