import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth/next';
import { authOptions } from '@/lib/auth';
import { prisma } from '@/lib/db';

export async function GET(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) {
    // Unauthenticated — no balance, no re-check detection
    return NextResponse.json({ freeChecks: 0, deepChecks: 0, isRecheck: false });
  }

  const { searchParams } = new URL(req.url);
  const entityAbn = searchParams.get('entityAbn') || undefined;
  const entityName = searchParams.get('entityName') || undefined;

  // Prefer ABN match; fall back to name match
  const priorWhere = entityAbn
    ? { userId: session.user.id, entityAbn }
    : entityName
      ? { userId: session.user.id, entityName }
      : null;

  const [balance, priorSearch] = await Promise.all([
    prisma.packBalance.findUnique({
      where: { userId: session.user.id },
      select: { freeChecks: true, deepChecks: true },
    }),
    priorWhere
      ? prisma.search.findFirst({ where: priorWhere, select: { id: true } })
      : Promise.resolve(null),
  ]);

  return NextResponse.json({
    freeChecks: balance?.freeChecks ?? 0,
    deepChecks: balance?.deepChecks ?? 0,
    isRecheck: priorSearch !== null,
  });
}
