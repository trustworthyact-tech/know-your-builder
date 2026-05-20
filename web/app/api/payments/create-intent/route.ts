import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth/next';
import { authOptions } from '@/lib/auth';
import { prisma } from '@/lib/db';
import { getStripe, PAYMENT_AMOUNTS } from '@/lib/stripe';
import { PaymentType } from '@prisma/client';

interface CreateIntentBody {
  paymentType: PaymentType;
  metadata?: Record<string, string>;
}

export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) {
    return NextResponse.json({ error: 'Unauthorised' }, { status: 401 });
  }

  let body: CreateIntentBody;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Invalid request body' }, { status: 400 });
  }

  const { paymentType, metadata } = body;

  if (!paymentType || !(paymentType in PAYMENT_AMOUNTS)) {
    return NextResponse.json(
      { error: 'Invalid or unsupported paymentType. Use RECHECK_SINGLE, RECHECK_5PACK, DEEP_CHECK_SINGLE, or DEEP_CHECK_5PACK.' },
      { status: 400 }
    );
  }

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
