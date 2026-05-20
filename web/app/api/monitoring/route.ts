import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth/next';
import { authOptions } from '@/lib/auth';
import { prisma } from '@/lib/db';
import { getStripe } from '@/lib/stripe';
import { enqueueInitialMonitoringJobs } from '@/lib/queues/monitoring';
import type Stripe from 'stripe';

export const dynamic = 'force-dynamic';

// GET — list active subscriptions for the authenticated user
export async function GET() {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) {
    return NextResponse.json({ error: 'Unauthorised' }, { status: 401 });
  }

  const subscriptions = await prisma.monitoringSubscription.findMany({
    where: { userId: session.user.id, active: true },
    orderBy: { createdAt: 'desc' },
  });

  return NextResponse.json({ subscriptions });
}

// POST — create Stripe Subscription + MonitoringSubscription + enqueue initial jobs
interface CreateMonitoringBody {
  entityName: string;
  entityAbn?: string;
}

export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) {
    return NextResponse.json({ error: 'Unauthorised' }, { status: 401 });
  }

  let body: CreateMonitoringBody;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Invalid request body' }, { status: 400 });
  }

  const entityName = body.entityName?.trim();
  const entityAbn = body.entityAbn?.trim() ?? '';

  if (!entityName) {
    return NextResponse.json({ error: 'entityName is required' }, { status: 400 });
  }

  const priceId = process.env.STRIPE_PRICE_MONITORING_MONTHLY;
  if (!priceId) {
    return NextResponse.json({ error: 'Monitoring is not configured' }, { status: 503 });
  }

  // Guard against duplicate active subscriptions
  const existing = await prisma.monitoringSubscription.findFirst({
    where: {
      userId: session.user.id,
      active: true,
      ...(entityAbn ? { entityAbn } : { entityName }),
    },
    select: { id: true },
  });
  if (existing) {
    return NextResponse.json({ error: 'Already monitoring this entity' }, { status: 409 });
  }

  const stripe = getStripe();

  // Create a Stripe Customer scoped to this subscription
  let customer: Stripe.Customer;
  try {
    customer = await stripe.customers.create({
      email: session.user.email!,
      metadata: { userId: session.user.id },
    });
  } catch (err) {
    console.error('[monitoring] Stripe customer creation failed:', err);
    return NextResponse.json({ error: 'Failed to set up subscription' }, { status: 500 });
  }

  // Create Stripe Subscription — incomplete until first invoice is paid
  let stripeSub: Stripe.Subscription;
  try {
    stripeSub = await stripe.subscriptions.create({
      customer: customer.id,
      items: [{ price: priceId }],
      payment_behavior: 'default_incomplete',
      payment_settings: { save_default_payment_method: 'on_subscription' },
      expand: ['latest_invoice.payment_intent'],
      metadata: { userId: session.user.id, entityAbn, entityName },
    });
  } catch (err) {
    console.error('[monitoring] Stripe subscription creation failed:', err);
    await stripe.customers.del(customer.id).catch(() => {});
    return NextResponse.json({ error: 'Failed to create subscription' }, { status: 500 });
  }

  const invoice = stripeSub.latest_invoice as Stripe.Invoice;
  const paymentIntent = invoice?.payment_intent as Stripe.PaymentIntent | null;
  const clientSecret = paymentIntent?.client_secret ?? null;

  const now = new Date();
  const nextDailyCheck = new Date(now.getTime() + 24 * 60 * 60 * 1000);
  const nextWeeklyCheck = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000);
  const nextMonthlyCheck = new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000);

  // Persist the subscription as active immediately so it appears in the dashboard.
  // If Stripe later cancels (failed payment), the customer.subscription.deleted webhook
  // sets active = false. upsert handles re-subscribing after a prior cancellation.
  let monitoringSub: { id: string };
  try {
    monitoringSub = await prisma.monitoringSubscription.upsert({
      where: { userId_entityAbn: { userId: session.user.id, entityAbn } },
      create: {
        userId: session.user.id,
        entityAbn,
        entityName,
        stripeSubId: stripeSub.id,
        active: true,
        nextDailyCheck,
        nextWeeklyCheck,
        nextMonthlyCheck,
      },
      update: {
        entityName,
        stripeSubId: stripeSub.id,
        active: true,
        nextDailyCheck,
        nextWeeklyCheck,
        nextMonthlyCheck,
      },
      select: { id: true },
    });
  } catch (err) {
    console.error('[monitoring] DB upsert failed:', err);
    await stripe.subscriptions.cancel(stripeSub.id).catch(() => {});
    return NextResponse.json({ error: 'Failed to save subscription' }, { status: 500 });
  }

  // Enqueue delayed jobs — the worker checks subscription.active before running, so these
  // are safe to enqueue before payment is confirmed; they will only run if/when active = true.
  enqueueInitialMonitoringJobs({
    userId: session.user.id,
    entityAbn,
    entityName,
    subscriptionId: monitoringSub.id,
  }).catch((err) => console.error('[monitoring] Failed to enqueue initial jobs:', err));

  return NextResponse.json({ clientSecret, subscriptionId: monitoringSub.id });
}

// DELETE — cancel a monitoring subscription by MonitoringSubscription.id
interface CancelBody {
  id: string;
}

export async function DELETE(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) {
    return NextResponse.json({ error: 'Unauthorised' }, { status: 401 });
  }

  let body: CancelBody;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Invalid request body' }, { status: 400 });
  }

  if (!body.id) {
    return NextResponse.json({ error: 'id is required' }, { status: 400 });
  }

  const sub = await prisma.monitoringSubscription.findFirst({
    where: { id: body.id, userId: session.user.id },
    select: { id: true, stripeSubId: true },
  });
  if (!sub) {
    return NextResponse.json({ error: 'Subscription not found' }, { status: 404 });
  }

  if (sub.stripeSubId) {
    await getStripe()
      .subscriptions.cancel(sub.stripeSubId)
      .catch((err) => console.error('[monitoring] Stripe cancellation failed:', err));
  }

  await prisma.monitoringSubscription.update({
    where: { id: body.id },
    data: { active: false },
  });

  return NextResponse.json({ cancelled: true });
}
