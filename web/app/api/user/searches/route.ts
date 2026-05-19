import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth/next';
import { authOptions } from '@/lib/auth';
import { prisma } from '@/lib/db';

export async function GET(req: NextRequest) {
  const session = await getServerSession(authOptions);

  if (!session?.user?.id) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const { searchParams } = new URL(req.url);
  const page = Math.max(1, parseInt(searchParams.get('page') ?? '1', 10));
  const limit = Math.min(50, Math.max(1, parseInt(searchParams.get('limit') ?? '10', 10)));
  const skip = (page - 1) * limit;

  const [searches, total] = await Promise.all([
    prisma.search.findMany({
      where: { userId: session.user.id },
      orderBy: { createdAt: 'desc' },
      skip,
      take: limit,
      select: {
        id: true,
        entityName: true,
        entityAbn: true,
        persona: true,
        projectType: true,
        projectState: true,
        isDeepCheck: true,
        riskSummary: true,
        createdAt: true,
      },
    }),
    prisma.search.count({ where: { userId: session.user.id } }),
  ]);

  return NextResponse.json({ searches, total, page, pageSize: limit });
}
