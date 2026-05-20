import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth/next';
import { authOptions } from '@/lib/auth';
import { prisma } from '@/lib/db';
import { Prisma } from '@prisma/client';

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

  return NextResponse.json({ timeline }, { status: 201 });
}
