import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth/next';
import { z } from 'zod';
import { authOptions } from '@/lib/auth';
import { prisma } from '@/lib/db';
import { Prisma } from '@prisma/client';

export const dynamic = 'force-dynamic';

interface Params {
  params: { searchId: string };
}

// Dates are plain "YYYY-MM-DD" strings from <input type="date"> on the client and are
// passed straight to `new Date(...)` below — z.iso.date() matches that shape (see the
// sibling POST route in ../route.ts for the same reasoning re: PAYMENT_DUE scheduling).
const paymentScheduleEntrySchema = z.object({
  label: z.string(),
  date: z.iso.date(),
  amountCents: z.number().int().nonnegative(),
});

const patchTimelineSchema = z.object({
  projectValue: z.string().nullable().optional(),
  contractSignedDate: z.iso.date().nullable().optional(),
  startDate: z.iso.date().nullable().optional(),
  completionDate: z.iso.date().nullable().optional(),
  paymentSchedule: z.array(paymentScheduleEntrySchema).optional(),
  financeArranged: z.boolean().nullable().optional(),
});

// GET — retrieve timeline for a search
export async function GET(_req: NextRequest, { params }: Params) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) {
    return NextResponse.json({ error: 'Unauthorised' }, { status: 401 });
  }

  const timeline = await prisma.projectTimeline.findUnique({
    where: { searchId: params.searchId },
  });

  if (!timeline) {
    return NextResponse.json({ timeline: null });
  }

  if (timeline.userId !== session.user.id) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  return NextResponse.json({ timeline });
}

// PATCH — update timeline for a search
export async function PATCH(req: NextRequest, { params }: Params) {
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

  const parsed = patchTimelineSchema.safeParse(json);
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? 'Invalid request body' },
      { status: 400 },
    );
  }
  const body = parsed.data;

  const existing = await prisma.projectTimeline.findUnique({
    where: { searchId: params.searchId },
    select: { userId: true },
  });

  if (!existing) {
    return NextResponse.json({ error: 'Timeline not found' }, { status: 404 });
  }

  if (existing.userId !== session.user.id) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  const timeline = await prisma.projectTimeline.update({
    where: { searchId: params.searchId },
    data: {
      ...(body.projectValue !== undefined && { projectValue: body.projectValue }),
      ...(body.contractSignedDate !== undefined && {
        contractSignedDate: body.contractSignedDate ? new Date(body.contractSignedDate) : null,
      }),
      ...(body.startDate !== undefined && {
        startDate: body.startDate ? new Date(body.startDate) : null,
      }),
      ...(body.completionDate !== undefined && {
        completionDate: body.completionDate ? new Date(body.completionDate) : null,
      }),
      ...(body.paymentSchedule !== undefined && {
        paymentSchedule: body.paymentSchedule as unknown as Prisma.InputJsonValue,
      }),
      ...(body.financeArranged !== undefined && { financeArranged: body.financeArranged }),
    },
  });

  return NextResponse.json({ timeline });
}
