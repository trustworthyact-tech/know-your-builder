import { redirect } from 'next/navigation';
import Link from 'next/link';
import { prisma } from '@/lib/db';

interface Props {
  searchParams: { token?: string; email?: string };
}

export default async function VerifyEmailPage({ searchParams }: Props) {
  const { token, email } = searchParams;

  if (!token || !email) {
    redirect('/auth/login?error=invalid-token');
  }

  const record = await prisma.verificationToken.findUnique({ where: { token } });

  if (!record || record.identifier !== email || record.expires < new Date()) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center px-4">
        <div className="bg-surface rounded-2xl shadow-md p-8 max-w-md w-full text-center">
          <div className="text-4xl mb-4">⚠️</div>
          <h1 className="text-xl font-bold text-text-primary mb-2">Link expired or invalid</h1>
          <p className="text-text-secondary text-sm mb-6">
            This verification link has expired or already been used. Please register again to get a
            new link.
          </p>
          <Link
            href="/auth/register"
            className="inline-block bg-primary text-white rounded-xl px-6 py-3 text-sm font-semibold"
          >
            Back to Register
          </Link>
        </div>
      </div>
    );
  }

  await prisma.$transaction([
    prisma.user.update({ where: { email }, data: { emailVerified: new Date() } }),
    prisma.verificationToken.delete({ where: { token } }),
  ]);

  redirect('/auth/login?verified=1');
}
