import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db';

export async function GET(
  _req: NextRequest,
  { params }: { params: { searchId: string } }
) {
  const { searchId } = params;

  const search = await prisma.search.findUnique({
    where: { id: searchId },
    select: {
      id: true,
      entityName: true,
      entityAbn: true,
      persona: true,
      projectType: true,
      projectStage: true,
      projectState: true,
      reportJson: true,
      isDeepCheck: true,
      createdAt: true,
    },
  });

  if (!search) {
    return NextResponse.json({ error: 'Report not found' }, { status: 404 });
  }

  return NextResponse.json(search);
}
