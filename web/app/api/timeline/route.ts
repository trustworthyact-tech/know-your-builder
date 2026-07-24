import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth/next';
import { z } from 'zod';
import { authOptions } from '@/lib/auth';
import { prisma } from '@/lib/db';
import { Prisma } from '@prisma/client';
import { enqueueSequence } from '@/lib/queues/emailSequence';

export const dynamic = 'force-dynamic';

// paymentSchedule[].date and the three milestone dates are all sourced from
// <input type="date"> on the client, i.e. plain "YYYY-MM-DD" strings — not full
// ISO datetimes — and are fed straight into `new Date(...)` downstream, including
// the PAYMENT_DUE initialDelay calculation below. z.iso.date() matches that shape.
const paymentScheduleEntrySchema = z.object({
  label: z.string(),
  date: z.iso.date(),
  amountCents: z.number().int().nonnegative(),
});

const createTimelineSchema = z.object({
  searchId: z.string().trim().min(1, 'searchId is required'),
  projectValue: z.string().optional(),
  contractSignedDate: z.iso.date().nullable().optional(),
  startDate: z.iso.date().nullable().optional(),
  completionDate: z.iso.date().nullable().optional(),
  paymentSchedule: z.array(paymentScheduleEntrySchema).optional(),
  financeArranged: z.boolean().nullable().optional(),
});

// POST — create a timeline for a search
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

  const parsed = createTimelineSchema.safeParse(json);
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? 'Invalid request body' },
      { status: 400 },
    );
  }
  const body = parsed.data;

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
