import { NextRequest, NextResponse } from 'next/server';
import bcrypt from 'bcryptjs';
import { z } from 'zod';
import { prisma } from '@/lib/db';
import { checkRateLimit, getClientIp } from '@/lib/rateLimit';

const bodySchema = z.object({
  email: z.string().email('A valid email is required'),
  token: z.string().min(1, 'token is required'),
  password: z.string().min(8, 'Password must be at least 8 characters'),
});

export async function POST(req: NextRequest) {
  const allowed = await checkRateLimit(`reset-password:${getClientIp(req)}`, 5, 60);
  if (!allowed) {
    return NextResponse.json({ error: 'Too many requests. Please try again later.' }, { status: 429 });
  }

  let rawBody: unknown;
  try {
    rawBody = await req.json();
  } catch {
    return NextResponse.json({ error: 'Invalid request body' }, { status: 400 });
  }

  const parsed = bodySchema.safeParse(rawBody);
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? 'Invalid request body' },
      { status: 400 }
    );
  }

  const { email, token, password } = parsed.data;

  // Look up the reset token
  const record = await prisma.verificationToken.findUnique({
    where: { identifier_token: { identifier: `password-reset:${email}`, token } },
  });

  if (!record) {
    return NextResponse.json(
      { error: 'Reset link is invalid or has already been used.' },
      { status: 400 }
    );
  }

  if (record.expires < new Date()) {
    await prisma.verificationToken.delete({
      where: { identifier_token: { identifier: `password-reset:${email}`, token } },
    });
    return NextResponse.json(
      { error: 'Reset link has expired. Please request a new one.' },
      { status: 400 }
    );
  }

  const user = await prisma.user.findUnique({ where: { email } });
  if (!user) {
    return NextResponse.json({ error: 'Account not found.' }, { status: 400 });
  }

  const passwordHash = await bcrypt.hash(password, 12);

  await prisma.$transaction([
    prisma.user.update({ where: { id: user.id }, data: { passwordHash } }),
    prisma.verificationToken.delete({
      where: { identifier_token: { identifier: `password-reset:${email}`, token } },
    }),
  ]);

  return NextResponse.json({ message: 'Password updated. You can now sign in.' });
}
