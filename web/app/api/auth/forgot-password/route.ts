import { NextRequest, NextResponse } from 'next/server';
import crypto from 'crypto';
import { z } from 'zod';
import { prisma } from '@/lib/db';
import { getResend } from '@/lib/resend';
import { render } from '@react-email/components';
import { PasswordReset } from '@/emails/PasswordReset';
import { checkRateLimit, getClientIp } from '@/lib/rateLimit';

const bodySchema = z.object({
  email: z.string().email('A valid email is required'),
});

export async function POST(req: NextRequest) {
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

  const { email } = parsed.data;

  // Rate limit by email (the mail-bomb target) and by IP so a single caller
  // can't cycle through many emails to route around the per-email limit.
  const emailAllowed = await checkRateLimit(`forgot-password:${email}`, 3, 60);
  const ipAllowed = await checkRateLimit(`forgot-password:${getClientIp(req)}`, 5, 60);
  if (!emailAllowed || !ipAllowed) {
    return NextResponse.json({ error: 'Too many requests. Please try again later.' }, { status: 429 });
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
