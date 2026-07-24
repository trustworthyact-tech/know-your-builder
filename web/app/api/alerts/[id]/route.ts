import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth/next';
import { z } from 'zod';
import { authOptions } from '@/lib/auth';
import { prisma } from '@/lib/db';

const paramsSchema = z.object({
  id: z.string().cuid(),
});

// PATCH /api/alerts/:id — mark an alert as read
export async function PATCH(
  _req: NextRequest,
  { params }: { params: { id: string } }
) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) {
    return NextResponse.json({ error: 'Unauthorised' }, { status: 401 });
  }

  const parsedParams = paramsSchema.safeParse(params);
  if (!parsedParams.success) {
    return NextResponse.json({ error: 'Invalid alert id' }, { status: 400 });
  }

  const alert = await prisma.alert.findFirst({
    where: { id: parsedParams.data.id, userId: session.user.id },
    select: { id: true },
  });
  if (!alert) {
    return NextResponse.json({ error: 'Alert not found' }, { status: 404 });
  }

  await prisma.alert.update({
    where: { id: parsedParams.data.id },
    data: { read: true },
  });

  return NextResponse.json({ ok: true });
}
