import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth/next';
import { authOptions } from '@/lib/auth';
import { prisma } from '@/lib/db';
import { Prisma } from '@prisma/client';

export const dynamic = 'force-dynamic';

interface Params {
  params: { searchId: string };
}

interface PaymentScheduleEntry {
  label: string;
  date: string;
  amountCents: number;
}

interface PatchBody {
  projectValue?: string | null;
  contractSignedDate?: string | null;
  startDate?: string | null;
  completionDate?: string | null;
  paymentSchedule?: PaymentScheduleEntry[];
  financeArranged?: boolean | null;
}

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

  let body: PatchBody;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Invalid request body' }, { status: 400 });
  }

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
