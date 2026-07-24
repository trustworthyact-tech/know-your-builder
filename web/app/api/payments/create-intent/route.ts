import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth/next';
import { z } from 'zod';
import { authOptions } from '@/lib/auth';
import { prisma } from '@/lib/db';
import { getStripe, PAYMENT_AMOUNTS } from '@/lib/stripe';
import { PaymentType } from '@prisma/client';

// Constrained to the payment types that are actually sold as one-off PaymentIntents.
// MONITORING_MONTHLY is a Stripe Subscription (see web/app/api/monitoring/route.ts) and is
// deliberately excluded from PAYMENT_AMOUNTS, so it's rejected by this schema itself.
const VALID_PAYMENT_TYPES = Object.keys(PAYMENT_AMOUNTS) as [string, ...string[]];

const createIntentSchema = z.object({
  paymentType: z.enum(VALID_PAYMENT_TYPES),
  metadata: z.record(z.string(), z.string()).optional(),
});

export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) {
    return NextResponse.json({ error: 'Unauthorised' }, { status: 401 });
  }

  let json: unknown;
  try {
    json = await req.json();
  } catch {
    return NextResponse.json({ error: 'Invalid request body' }, { status: 400 });
  }

  const parsed = createIntentSchema.safeParse(json);
  if (!parsed.success) {
    const paymentTypeInvalid = parsed.error.issues.some((issue) => issue.path[0] === 'paymentType');
    const error = paymentTypeInvalid
      ? `Invalid or unsupported paymentType. Use ${VALID_PAYMENT_TYPES.join(', ')}.`
      : (parsed.error.issues[0]?.message ?? 'Invalid request body');
    return NextResponse.json({ error }, { status: 400 });
  }

  const { metadata } = parsed.data;
  const paymentType = parsed.data.paymentType as PaymentType;

  const amountCents = PAYMENT_AMOUNTS[paymentType];
  const stripe = getStripe();

  let intent;
  try {
    intent = await stripe.paymentIntents.create({
      amount: amountCents,
      currency: 'aud',
      metadata: {
        userId: session.user.id,
        paymentType,
        ...metadata,
      },
    });
  } catch (err) {
    console.error('[payments/create-intent] Stripe error:', err);
    return NextResponse.json({ error: 'Failed to create payment intent' }, { status: 500 });
  }

  try {
    await prisma.payment.create({
      data: {
        userId: session.user.id,
        stripePaymentId: intent.id,
        amountCents,
        paymentType,
        metadata: metadata ?? {},
      },
    });
  } catch (err) {
    console.error('[payments/create-intent] DB error:', err);
    // Non-fatal: the PI exists in Stripe; the webhook will re-verify on success
  }

  return NextResponse.json({ clientSecret: intent.client_secret });
}
