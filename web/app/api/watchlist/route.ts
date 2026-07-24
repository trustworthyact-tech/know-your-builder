import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth/next';
import { z } from 'zod';
import { authOptions } from '@/lib/auth';
import { prisma } from '@/lib/db';

export const dynamic = 'force-dynamic';

// GET — list watchlist items with last search summary
export async function GET() {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) {
    return NextResponse.json({ error: 'Unauthorised' }, { status: 401 });
  }

  const items = await prisma.watchlistItem.findMany({
    where: { userId: session.user.id },
    orderBy: { createdAt: 'desc' },
    include: {
      lastSearch: {
        select: {
          id: true,
          createdAt: true,
          riskSummary: true,
          isDeepCheck: true,
        },
      },
    },
  });

  return NextResponse.json({ items });
}

// POST — add an entity to the watchlist (upsert on userId+entityAbn)
const addBodySchema = z.object({
  entityName: z.string().trim().min(1, 'entityName is required'),
  entityAbn: z.string().trim().min(1, 'entityAbn is required'),
  lastSearchId: z.string().min(1).optional(),
});

export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) {
    return NextResponse.json({ error: 'Unauthorised' }, { status: 401 });
  }

  let rawBody: unknown;
  try {
    rawBody = await req.json();
  } catch {
    return NextResponse.json({ error: 'Invalid request body' }, { status: 400 });
  }

  const parsed = addBodySchema.safeParse(rawBody);
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? 'Invalid request body' },
      { status: 400 }
    );
  }
  const { entityName, entityAbn, lastSearchId } = parsed.data;

  // Ownership check: lastSearchId is client-supplied and must belong to the requesting
  // user before it is persisted, otherwise a malicious caller could associate their
  // watchlist item with another user's private search record.
  if (lastSearchId) {
    const owned = await prisma.search.findFirst({
      where: { id: lastSearchId, userId: session.user.id },
      select: { id: true },
    });
    if (!owned) {
      return NextResponse.json({ error: 'lastSearchId is invalid' }, { status: 400 });
    }
  }

  const item = await prisma.watchlistItem.upsert({
    where: { userId_entityAbn: { userId: session.user.id, entityAbn } },
    create: {
      userId: session.user.id,
      entityName,
      entityAbn,
      lastSearchId: lastSearchId ?? null,
    },
    update: {
      entityName,
      ...(lastSearchId ? { lastSearchId } : {}),
    },
  });

  return NextResponse.json({ item }, { status: 201 });
}

// DELETE — remove an entity from the watchlist by entityAbn
const removeBodySchema = z.object({
  entityAbn: z.string().trim().min(1, 'entityAbn is required'),
});

export async function DELETE(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) {
    return NextResponse.json({ error: 'Unauthorised' }, { status: 401 });
  }

  let rawBody: unknown;
  try {
    rawBody = await req.json();
  } catch {
    return NextResponse.json({ error: 'Invalid request body' }, { status: 400 });
  }

  const parsed = removeBodySchema.safeParse(rawBody);
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? 'Invalid request body' },
      { status: 400 }
    );
  }
  const { entityAbn } = parsed.data;

  const deleted = await prisma.watchlistItem.deleteMany({
    where: { userId: session.user.id, entityAbn },
  });

  if (deleted.count === 0) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 });
  }

  return NextResponse.json({ removed: true });
}
