import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/lib/db';
import { checkRateLimit, getClientIp } from '@/lib/rateLimit';
import { WAITLIST_PRODUCTS } from '@/lib/marketing/waitlist';

export const dynamic = 'force-dynamic';

const bodySchema = z.object({
  email: z.string().trim().toLowerCase().email('Enter a valid email address'),
  product: z.enum(WAITLIST_PRODUCTS),
  persona: z.enum(['owner_builder', 'subcontractor', 'developer', 'other']).optional(),
});

export async function POST(req: NextRequest) {
  let rawBody: unknown;
  try {
    rawBody = await req.json();
  } catch {
    return NextResponse.json({ error: 'Invalid request body' }, { status: 400 });
  }

  const parsed = bodySchema.safeParse(rawBody);
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? 'Invalid request body' },
      { status: 400 }
    );
  }

  const { email, product, persona } = parsed.data;

  // Best-effort: a Redis outage shouldn't block a signup.
  try {
    const allowed = await checkRateLimit(`waitlist:${getClientIp(req)}`, 10, 600);
    if (!allowed) {
      return NextResponse.json({ error: 'Too many signups. Please try again later.' }, { status: 429 });
    }
  } catch (err) {
    console.error('[waitlist] rate limit check failed:', err);
  }

  try {
    await prisma.waitlistSignup.upsert({
      where: { email_product: { email, product } },
      create: { email, product, persona },
      update: persona ? { persona } : {},
    });
  } catch (err) {
    console.error('[waitlist] save failed:', err);
    return NextResponse.json({ error: 'Something went wrong. Please try again.' }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
}
