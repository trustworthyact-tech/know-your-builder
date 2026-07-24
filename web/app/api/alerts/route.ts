import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth/next';
import { z } from 'zod';
import { authOptions } from '@/lib/auth';
import { prisma } from '@/lib/db';

export const dynamic = 'force-dynamic';

const getQuerySchema = z.object({
  read: z.enum(['true', 'false']).optional(),
});

// GET /api/alerts?read=true|false  (omit param to return all)
export async function GET(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) {
    return NextResponse.json({ error: 'Unauthorised' }, { status: 401 });
  }

  const { searchParams } = new URL(req.url);
  const parsed = getQuerySchema.safeParse({ read: searchParams.get('read') ?? undefined });
  if (!parsed.success) {
    return NextResponse.json({ error: 'Invalid query parameters' }, { status: 400 });
  }
  const readParam = parsed.data.read;

  const where: { userId: string; read?: boolean } = { userId: session.user.id };
  if (readParam === 'true') where.read = true;
  if (readParam === 'false') where.read = false;

  const alerts = await prisma.alert.findMany({
    where,
    orderBy: { createdAt: 'desc' },
    take: 100,
  });

  return NextResponse.json({ alerts });
}
