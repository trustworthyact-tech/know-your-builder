import { NextRequest, NextResponse } from 'next/server';
import bcrypt from 'bcryptjs';
import { prisma } from '@/lib/db';

export async function POST(req: NextRequest) {
  let body: { email?: string; token?: string; password?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Invalid request body' }, { status: 400 });
  }

  const { email, token, password } = body;

  if (!email || !token || !password) {
    return NextResponse.json({ error: 'email, token, and password are required' }, { status: 400 });
  }

  if (password.length < 8) {
    return NextResponse.json(
      { error: 'Password must be at least 8 characters' },
      { status: 400 }
    );
  }

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
