import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth/next';
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
interface AddBody {
  entityName: string;
  entityAbn: string;
  lastSearchId?: string;
}

export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) {
    return NextResponse.json({ error: 'Unauthorised' }, { status: 401 });
  }

  let body: AddBody;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Invalid request body' }, { status: 400 });
  }

  const entityName = body.entityName?.trim();
  const entityAbn = body.entityAbn?.trim();

  if (!entityName || !entityAbn) {
    return NextResponse.json({ error: 'entityName and entityAbn are required' }, { status: 400 });
  }

  const item = await prisma.watchlistItem.upsert({
    where: { userId_entityAbn: { userId: session.user.id, entityAbn } },
    create: {
      userId: session.user.id,
      entityName,
      entityAbn,
      lastSearchId: body.lastSearchId ?? null,
    },
    update: {
      entityName,
      ...(body.lastSearchId ? { lastSearchId: body.lastSearchId } : {}),
    },
  });

  return NextResponse.json({ item }, { status: 201 });
}

// DELETE — remove an entity from the watchlist by entityAbn
interface RemoveBody {
  entityAbn: string;
}

export async function DELETE(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) {
    return NextResponse.json({ error: 'Unauthorised' }, { status: 401 });
  }

  let body: RemoveBody;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Invalid request body' }, { status: 400 });
  }

  if (!body.entityAbn) {
    return NextResponse.json({ error: 'entityAbn is required' }, { status: 400 });
  }

  const deleted = await prisma.watchlistItem.deleteMany({
    where: { userId: session.user.id, entityAbn: body.entityAbn },
  });

  if (deleted.count === 0) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 });
  }

  return NextResponse.json({ removed: true });
}
