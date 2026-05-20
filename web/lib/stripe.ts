import Stripe from 'stripe';

const globalForStripe = globalThis as unknown as { stripe?: Stripe };

export function getStripe(): Stripe {
  if (!globalForStripe.stripe) {
    globalForStripe.stripe = new Stripe(process.env.STRIPE_SECRET_KEY!, {
      apiVersion: '2024-06-20',
    });
  }
  return globalForStripe.stripe;
}

export const PAYMENT_AMOUNTS: Record<string, number> = {
  RECHECK_SINGLE: 300,
  RECHECK_5PACK: 1200,
  DEEP_CHECK_SINGLE: 1500,
  DEEP_CHECK_5PACK: 5500,
};

export const PAYMENT_LABELS: Record<string, string> = {
  RECHECK_SINGLE: 'Re-check (single)',
  RECHECK_5PACK: 'Re-check 5-pack',
  DEEP_CHECK_SINGLE: 'Deep check (single)',
  DEEP_CHECK_5PACK: 'Deep check 5-pack',
};
