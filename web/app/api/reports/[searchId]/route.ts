import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth/next';
import { authOptions } from '@/lib/auth';
import { prisma } from '@/lib/db';

export const dynamic = 'force-dynamic';

export async function GET(
  _req: NextRequest,
  { params }: { params: { searchId: string } }
) {
  const { searchId } = params;
  const session = await getServerSession(authOptions);

  const search = await prisma.search.findFirst({
    where: {
      id: searchId,
      OR: [{ userId: session?.user?.id ?? '__none__' }, { userId: null }],
    },
    select: {
      id: true,
      entityName: true,
      entityAbn: true,
      persona: true,
      projectType: true,
      projectStage: true,
      projectState: true,
      reportJson: true,
      riskSummary: true,
      isDeepCheck: true,
      createdAt: true,
    },
  });

  if (!search) {
    return NextResponse.json({ error: 'Report not found' }, { status: 404 });
  }

  return NextResponse.json(search);
}
