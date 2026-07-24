import { getRedis } from '@/lib/redis';

// Fixed-window counter. Returns true if the request is within the limit and
// should proceed, false if it should be rejected (429).
export async function checkRateLimit(
  key: string,
  limit: number,
  windowSeconds: number
): Promise<boolean> {
  const redis = getRedis();
  const redisKey = `ratelimit:${key}`;

  const count = await redis.incr(redisKey);
  if (count === 1) {
    await redis.expire(redisKey, windowSeconds);
  }

  return count <= limit;
}
