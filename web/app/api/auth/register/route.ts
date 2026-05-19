import { NextRequest, NextResponse } from 'next/server';
import crypto from 'crypto';
import bcrypt from 'bcryptjs';
import { prisma } from '@/lib/db';
import { getResend } from '@/lib/resend';
import { render } from '@react-email/components';
import { VerifyEmail } from '@/emails/VerifyEmail';

interface RegisterBody {
  name?: string;
  email: string;
  password: string;
}

export async function POST(req: NextRequest) {
  let body: RegisterBody;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Invalid request body' }, { status: 400 });
  }

  const { name, email, password } = body;

  if (!email || !password) {
    return NextResponse.json({ error: 'Email and password are required' }, { status: 400 });
  }

  if (password.length < 8) {
    return NextResponse.json(
      { error: 'Password must be at least 8 characters' },
      { status: 400 }
    );
  }

  const existing = await prisma.user.findUnique({ where: { email } });
  if (existing) {
    return NextResponse.json(
      { error: 'An account with this email already exists' },
      { status: 409 }
    );
  }

  const passwordHash = await bcrypt.hash(password, 12);
  const token = crypto.randomBytes(32).toString('hex');
  const expires = new Date(Date.now() + 24 * 60 * 60 * 1000);

  const user = await prisma.user.create({
    data: { email, name: name || null, passwordHash },
  });

  await prisma.verificationToken.create({
    data: { identifier: email, token, expires },
  });

  // Send verification email (best-effort — never fail the response)
  try {
    const appUrl = process.env.NEXTAUTH_URL ?? 'http://localhost:3000';
    const verifyUrl = `${appUrl}/auth/verify-email?token=${token}&email=${encodeURIComponent(email)}`;
    const html = await render(VerifyEmail({ name: name || email, verifyUrl }));
    await getResend().emails.send({
      from: process.env.FROM_EMAIL ?? 'noreply@knowyourbuilder.com.au',
      to: email,
      subject: 'Verify your Know Your Builder account',
      html,
    });
  } catch (err) {
    console.error('[auth/register] Email send error:', err);
  }

  return NextResponse.json({ userId: user.id }, { status: 201 });
}
