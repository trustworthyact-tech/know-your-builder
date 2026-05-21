import { NextRequest, NextResponse } from 'next/server';
import crypto from 'crypto';
import { prisma } from '@/lib/db';
import { getResend } from '@/lib/resend';
import { render } from '@react-email/components';
import { PasswordReset } from '@/emails/PasswordReset';

export async function POST(req: NextRequest) {
  let body: { email?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Invalid request body' }, { status: 400 });
  }

  const { email } = body;
  if (!email) {
    return NextResponse.json({ error: 'Email is required' }, { status: 400 });
  }

  // Always return 200 to avoid user enumeration — silently no-op if user not found
  const user = await prisma.user.findUnique({ where: { email } });
  if (!user || !user.passwordHash) {
    return NextResponse.json({ message: 'If an account exists, a reset link has been sent.' });
  }

  const token = crypto.randomBytes(32).toString('hex');
  const expires = new Date(Date.now() + 60 * 60 * 1000); // 1 hour

  // Upsert: if a prior reset token exists for this email, overwrite it
  await prisma.verificationToken.upsert({
    where: { identifier_token: { identifier: `password-reset:${email}`, token: '' } },
    create: { identifier: `password-reset:${email}`, token, expires },
    update: { token, expires },
  }).catch(async () => {
    // If no existing token, the upsert where clause fails — create fresh
    await prisma.verificationToken.deleteMany({
      where: { identifier: `password-reset:${email}` },
    });
    await prisma.verificationToken.create({
      data: { identifier: `password-reset:${email}`, token, expires },
    });
  });

  try {
    const appUrl = process.env.NEXTAUTH_URL ?? 'http://localhost:3000';
    const resetUrl = `${appUrl}/auth/reset-password?token=${token}&email=${encodeURIComponent(email)}`;
    const html = await render(PasswordReset({ name: user.name || email, resetUrl }));
    await getResend().emails.send({
      from: process.env.FROM_EMAIL ?? 'noreply@knowyourbuilder.com.au',
      to: email,
      subject: 'Reset your Know Your Builder password',
      html,
    });
  } catch (err) {
    console.error('[forgot-password] Email send error:', err);
  }

  return NextResponse.json({ message: 'If an account exists, a reset link has been sent.' });
}
