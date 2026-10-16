import { getServerSession } from 'next-auth/next';
import { redirect } from 'next/navigation';
import { authOptions } from '@/lib/auth';
import { prisma } from '@/lib/db';
import { MonitoringContent } from './MonitoringContent';

export default async function MonitoringPage() {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) {
    redirect('/auth/login?callbackUrl=/account/monitoring');
  }

  const subscriptions = await prisma.monitoringSubscription.findMany({
    where: { userId: session.user.id, active: true },
    orderBy: { createdAt: 'desc' },
    select: {
      id: true,
      entityName: true,
      entityAbn: true,
      nextDailyCheck: true,
      nextMonthlyCheck: true,
      createdAt: true,
    },
  });

  const serialized = subscriptions.map((s) => ({
    ...s,
    nextDailyCheck: s.nextDailyCheck.toISOString(),
    nextMonthlyCheck: s.nextMonthlyCheck.toISOString(),
    createdAt: s.createdAt.toISOString(),
  }));

  return <MonitoringContent subscriptions={serialized} />;
}
