import { NextRequest } from 'next/server';
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

// Best-effort client IP for rate-limit keying. Trusts x-forwarded-for since
// this app runs behind a proxy/load balancer in production.
export function getClientIp(req: NextRequest): string {
  const forwardedFor = req.headers.get('x-forwarded-for');
  if (forwardedFor) return forwardedFor.split(',')[0].trim();
  return req.headers.get('x-real-ip') ?? 'unknown';
}
