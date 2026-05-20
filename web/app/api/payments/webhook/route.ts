import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { getStripe } from '@/lib/stripe';
import type Stripe from 'stripe';

// Next.js must not parse the body — Stripe needs the raw bytes to verify the signature.
export const dynamic = 'force-dynamic';

export async function POST(req: NextRequest) {
  const body = await req.text();
  const sig = req.headers.get('stripe-signature');

  if (!sig) {
    return NextResponse.json({ error: 'Missing stripe-signature header' }, { status: 400 });
  }

  const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;
  if (!webhookSecret) {
    console.error('[payments/webhook] STRIPE_WEBHOOK_SECRET is not set');
    return NextResponse.json({ error: 'Webhook secret not configured' }, { status: 500 });
  }

  let event: Stripe.Event;
  try {
    event = getStripe().webhooks.constructEvent(body, sig, webhookSecret);
  } catch (err) {
    console.error('[payments/webhook] Signature verification failed:', err);
    return NextResponse.json({ error: 'Invalid signature' }, { status: 400 });
  }

  if (event.type === 'payment_intent.succeeded') {
    const intent = event.data.object as Stripe.PaymentIntent;
    const { userId, paymentType } = intent.metadata ?? {};

    if (!userId || !paymentType) {
      console.error('[payments/webhook] Missing metadata on intent', intent.id);
      return NextResponse.json({ received: true });
    }

    let freeCheckCredits = 0;
    let deepCheckCredits = 0;

    if (paymentType === 'RECHECK_SINGLE') freeCheckCredits = 1;
    else if (paymentType === 'RECHECK_5PACK') freeCheckCredits = 5;
    else if (paymentType === 'DEEP_CHECK_SINGLE') deepCheckCredits = 1;
    else if (paymentType === 'DEEP_CHECK_5PACK') deepCheckCredits = 5;

    if (freeCheckCredits > 0 || deepCheckCredits > 0) {
      try {
        await prisma.packBalance.upsert({
          where: { userId },
          create: { userId, freeChecks: freeCheckCredits, deepChecks: deepCheckCredits },
          update: {
            freeChecks: { increment: freeCheckCredits },
            deepChecks: { increment: deepCheckCredits },
          },
        });
      } catch (err) {
        console.error('[payments/webhook] Failed to credit PackBalance:', err);
        // Return 500 so Stripe retries the webhook
        return NextResponse.json({ error: 'Failed to credit balance' }, { status: 500 });
      }
    }
  }

  return NextResponse.json({ received: true });
}
