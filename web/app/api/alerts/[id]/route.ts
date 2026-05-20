import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth/next';
import { authOptions } from '@/lib/auth';
import { prisma } from '@/lib/db';

// PATCH /api/alerts/:id — mark an alert as read
export async function PATCH(
  _req: NextRequest,
  { params }: { params: { id: string } }
) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) {
    return NextResponse.json({ error: 'Unauthorised' }, { status: 401 });
  }

  const alert = await prisma.alert.findFirst({
    where: { id: params.id, userId: session.user.id },
    select: { id: true },
  });
  if (!alert) {
    return NextResponse.json({ error: 'Alert not found' }, { status: 404 });
  }

  await prisma.alert.update({
    where: { id: params.id },
    data: { read: true },
  });

  return NextResponse.json({ ok: true });
}
