import { getServerSession } from 'next-auth/next';
import { redirect } from 'next/navigation';
import Link from 'next/link';
import { authOptions } from '@/lib/auth';
import { prisma } from '@/lib/db';
import { ReportCard } from '@/components/ReportCard';

const PAGE_SIZE = 10;

export default async function AccountReportsPage({
  searchParams,
}: {
  searchParams: { page?: string };
}) {
  const session = await getServerSession(authOptions);

  if (!session?.user?.id) {
    redirect('/auth/login?callbackUrl=/account/reports');
  }

  const page = Math.max(1, parseInt(searchParams.page ?? '1', 10));
  const skip = (page - 1) * PAGE_SIZE;

  const [searches, total, packBalance] = await Promise.all([
    prisma.search.findMany({
      where: { userId: session.user.id },
      orderBy: { createdAt: 'desc' },
      skip,
      take: PAGE_SIZE,
      select: {
        id: true,
        entityName: true,
        entityAbn: true,
        persona: true,
        projectType: true,
        projectState: true,
        isDeepCheck: true,
        riskSummary: true,
        createdAt: true,
      },
    }),
    prisma.search.count({ where: { userId: session.user.id } }),
    prisma.packBalance.findUnique({
      where: { userId: session.user.id },
      select: { freeChecks: true },
    }),
  ]);

  const freeChecks = packBalance?.freeChecks ?? 0;

  const totalPages = Math.ceil(total / PAGE_SIZE);

  const serialized = searches.map((s) => ({
    ...s,
    createdAt: s.createdAt.toISOString(),
  }));

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <div>
          <h2 className="text-lg font-semibold text-text-primary">Saved Reports</h2>
          <p className="text-sm text-text-muted mt-0.5">
            {total === 0 ? 'No reports yet' : `${total} report${total !== 1 ? 's' : ''}`}
          </p>
          {freeChecks > 0 && (
            <p className="text-xs text-success mt-1">
              {freeChecks} re-check credit{freeChecks !== 1 ? 's' : ''} available
            </p>
          )}
        </div>
        <Link
          href="/"
          className="text-sm font-semibold bg-primary text-white rounded-lg px-4 py-2 hover:bg-primary-light transition-colors"
        >
          New check
        </Link>
      </div>

      {serialized.length === 0 ? (
        <div className="text-center py-16 bg-surface rounded-xl border border-border-light">
          <p className="text-text-muted text-sm">Run your first check to see reports here.</p>
          <Link
            href="/"
            className="mt-4 inline-block text-sm font-semibold text-primary hover:underline"
          >
            Search a builder →
          </Link>
        </div>
      ) : (
        <>
          <ul className="space-y-3">
            {serialized.map((search) => (
              <li key={search.id}>
                <ReportCard search={search} freeChecks={freeChecks} />
              </li>
            ))}
          </ul>

          {totalPages > 1 && (
            <div className="flex items-center justify-center gap-4 mt-8">
              {page > 1 && (
                <Link
                  href={`/account/reports?page=${page - 1}`}
                  className="text-sm font-medium text-text-secondary hover:text-primary transition-colors"
                >
                  ← Prev
                </Link>
              )}
              <span className="text-sm text-text-muted">
                Page {page} of {totalPages}
              </span>
              {page < totalPages && (
                <Link
                  href={`/account/reports?page=${page + 1}`}
                  className="text-sm font-medium text-text-secondary hover:text-primary transition-colors"
                >
                  Next →
                </Link>
              )}
            </div>
          )}
        </>
      )}
    </div>
  );
}
