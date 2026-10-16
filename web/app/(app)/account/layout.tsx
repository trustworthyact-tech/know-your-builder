import { getServerSession } from 'next-auth/next';
import { redirect } from 'next/navigation';
import { authOptions } from '@/lib/auth';
import { AccountTabNav } from '@/components/AccountTabNav';

export default async function AccountLayout({ children }: { children: React.ReactNode }) {
  const session = await getServerSession(authOptions);

  if (!session?.user) {
    redirect('/auth/login?callbackUrl=/account/reports');
  }

  return (
    <div className="min-h-screen bg-background">
      <div className="bg-surface border-b border-border-light">
        <div className="max-w-5xl mx-auto px-4 py-6">
          <h1 className="text-xl font-bold text-text-primary">Account</h1>
          <p className="text-sm text-text-muted mt-0.5">{session.user.email}</p>
        </div>
      </div>
      <AccountTabNav />
      <main className="max-w-5xl mx-auto px-4 py-8">{children}</main>
    </div>
  );
}
