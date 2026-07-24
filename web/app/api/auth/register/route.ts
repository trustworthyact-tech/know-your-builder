import { NextRequest, NextResponse } from 'next/server';
import crypto from 'crypto';
import bcrypt from 'bcryptjs';
import { z } from 'zod';
import { prisma } from '@/lib/db';
import { getResend } from '@/lib/resend';
import { render } from '@react-email/components';
import { VerifyEmail } from '@/emails/VerifyEmail';
import { checkRateLimit, getClientIp } from '@/lib/rateLimit';

const bodySchema = z.object({
  name: z.string().trim().min(1).optional(),
  email: z.string().email('A valid email is required'),
  password: z.string().min(8, 'Password must be at least 8 characters'),
});

export async function POST(req: NextRequest) {
  const allowed = await checkRateLimit(`register:${getClientIp(req)}`, 5, 60);
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

  const { name, email, password } = parsed.data;

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
