import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth/next';
import { authOptions } from '@/lib/auth';
import { prisma } from '@/lib/db';
import { Prisma } from '@prisma/client';
import { enqueueSequence } from '@/lib/queues/emailSequence';

export const dynamic = 'force-dynamic';

interface PaymentScheduleEntry {
  label: string;
  date: string;
  amountCents: number;
}

interface CreateBody {
  searchId: string;
  projectValue?: string;
  contractSignedDate?: string | null;
  startDate?: string | null;
  completionDate?: string | null;
  paymentSchedule?: PaymentScheduleEntry[];
  financeArranged?: boolean | null;
}

// POST — create a timeline for a search
export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) {
    return NextResponse.json({ error: 'Unauthorised' }, { status: 401 });
  }

  let body: CreateBody;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Invalid request body' }, { status: 400 });
  }

  if (!body.searchId) {
    return NextResponse.json({ error: 'searchId is required' }, { status: 400 });
  }

  // Verify the search belongs to the session user
  const search = await prisma.search.findUnique({
    where: { id: body.searchId },
    select: { userId: true },
  });

  if (!search || search.userId !== session.user.id) {
    return NextResponse.json({ error: 'Search not found' }, { status: 404 });
  }

  const schedule = (body.paymentSchedule ?? []) as unknown as Prisma.InputJsonValue;

  const timeline = await prisma.projectTimeline.upsert({
    where: { searchId: body.searchId },
    create: {
      userId: session.user.id,
      searchId: body.searchId,
      projectValue: body.projectValue ?? null,
      contractSignedDate: body.contractSignedDate ? new Date(body.contractSignedDate) : null,
      startDate: body.startDate ? new Date(body.startDate) : null,
      completionDate: body.completionDate ? new Date(body.completionDate) : null,
      paymentSchedule: schedule,
      financeArranged: body.financeArranged ?? null,
    },
    update: {
      projectValue: body.projectValue ?? null,
      contractSignedDate: body.contractSignedDate ? new Date(body.contractSignedDate) : null,
      startDate: body.startDate ? new Date(body.startDate) : null,
      completionDate: body.completionDate ? new Date(body.completionDate) : null,
      paymentSchedule: schedule,
      financeArranged: body.financeArranged ?? null,
    },
  });

  // Enqueue PAYMENT_DUE for the soonest upcoming milestone (2 days before it fires)
  if (body.paymentSchedule && body.paymentSchedule.length > 0) {
    const TWO_DAYS_MS = 2 * 24 * 60 * 60 * 1000;
    const now = Date.now();
    const upcoming = body.paymentSchedule
      .map((e) => ({ ...e, ms: new Date(e.date).getTime() }))
      .filter((e) => e.ms - TWO_DAYS_MS > now)
      .sort((a, b) => a.ms - b.ms)[0];

    if (upcoming) {
      const initialDelay = upcoming.ms - TWO_DAYS_MS - now;
      enqueueSequence(session.user.id, body.searchId, 'PAYMENT_DUE', { initialDelay }).catch(
        (err) => console.error('[timeline] PAYMENT_DUE enqueue error:', err),
      );
    }
  }

  return NextResponse.json({ timeline }, { status: 201 });
}
