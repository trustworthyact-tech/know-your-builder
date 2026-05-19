import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth/next';
import { authOptions } from '@/lib/auth';
import { prisma } from '@/lib/db';

export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) {
    return NextResponse.json({ error: 'Unauthorised' }, { status: 401 });
  }

  let body: { searchId: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Invalid request body' }, { status: 400 });
  }

  const { searchId } = body;
  if (!searchId) {
    return NextResponse.json({ error: 'searchId is required' }, { status: 400 });
  }

  const search = await prisma.search.findFirst({
    where: { id: searchId, userId: session.user.id },
    select: { id: true },
  });

  if (!search) {
    return NextResponse.json({ error: 'Report not found' }, { status: 404 });
  }

  const expiresAt = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);

  const link = await prisma.shareableLink.upsert({
    where: { searchId },
    create: { searchId, expiresAt },
    update: { expiresAt },
  });

  const appUrl = process.env.NEXTAUTH_URL ?? 'http://localhost:3000';
  const shareUrl = `${appUrl}/report/share/${link.token}`;

  return NextResponse.json({ token: link.token, shareUrl, expiresAt: link.expiresAt });
}
