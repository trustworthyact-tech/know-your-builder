import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db';

export async function GET(
  _req: NextRequest,
  { params }: { params: { token: string } }
) {
  const { token } = params;

  const link = await prisma.shareableLink.findUnique({
    where: { token },
    include: {
      search: {
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
      },
    },
  });

  if (!link) {
    return NextResponse.json({ error: 'Share link not found' }, { status: 404 });
  }

  if (link.expiresAt < new Date()) {
    return NextResponse.json({ error: 'Share link has expired' }, { status: 404 });
  }

  return NextResponse.json(link.search);
}
