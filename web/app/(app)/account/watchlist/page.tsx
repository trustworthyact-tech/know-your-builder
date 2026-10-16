import { getServerSession } from 'next-auth/next';
import { redirect } from 'next/navigation';
import { authOptions } from '@/lib/auth';
import { prisma } from '@/lib/db';
import { WatchlistContent } from './WatchlistContent';

export default async function WatchlistPage() {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) {
    redirect('/auth/login?callbackUrl=/account/watchlist');
  }

  const [items, packBalance] = await Promise.all([
    prisma.watchlistItem.findMany({
      where: { userId: session.user.id },
      orderBy: { createdAt: 'desc' },
      include: {
        lastSearch: {
          select: {
            id: true,
            createdAt: true,
            riskSummary: true,
            isDeepCheck: true,
          },
        },
      },
    }),
    prisma.packBalance.findUnique({
      where: { userId: session.user.id },
      select: { freeChecks: true },
    }),
  ]);

  const serialized = items.map((item) => ({
    id: item.id,
    entityName: item.entityName,
    entityAbn: item.entityAbn,
    createdAt: item.createdAt.toISOString(),
    lastSearch: item.lastSearch
      ? {
          id: item.lastSearch.id,
          createdAt: item.lastSearch.createdAt.toISOString(),
          riskSummary: item.lastSearch.riskSummary,
          isDeepCheck: item.lastSearch.isDeepCheck,
        }
      : null,
  }));

  return (
    <WatchlistContent
      items={serialized}
      freeChecks={packBalance?.freeChecks ?? 0}
    />
  );
}
