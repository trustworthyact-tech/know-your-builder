import { getServerSession } from 'next-auth/next';
import { redirect } from 'next/navigation';
import { authOptions } from '@/lib/auth';
import { prisma } from '@/lib/db';
import { AlertsContent } from './AlertsContent';

export default async function AlertsPage() {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) {
    redirect('/auth/login?callbackUrl=/account/alerts');
  }

  const alerts = await prisma.alert.findMany({
    where: { userId: session.user.id },
    orderBy: { createdAt: 'desc' },
    take: 100,
  });

  const serialized = alerts.map((a) => ({
    ...a,
    createdAt: a.createdAt.toISOString(),
  }));

  return <AlertsContent alerts={serialized} />;
}
