import Link from 'next/link';
import { prisma } from '@/lib/db';
import { ComparisonColumn, ComparisonData } from '@/components/ComparisonColumn';

const MAX_BUILDERS = 3;

interface Props {
  searchParams: { ids?: string };
}

function ErrorPage({ message }: { message: string }) {
  return (
    <main className="min-h-screen bg-background flex items-center justify-center px-4">
      <div className="text-center max-w-sm">
        <p className="text-text-secondary mb-4">{message}</p>
        <Link
          href="/"
          className="text-sm font-semibold text-primary hover:underline"
        >
          ← New search
        </Link>
      </div>
    </main>
  );
}

export default async function ComparePage({ searchParams }: Props) {
  const rawIds = searchParams.ids ?? '';
  const ids = rawIds
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);

  if (ids.length === 0) {
    return (
      <ErrorPage message="No builder IDs provided. Use ?ids=id1,id2 to compare reports." />
    );
  }

  if (ids.length > MAX_BUILDERS) {
    return (
      <ErrorPage
        message={`You can compare up to ${MAX_BUILDERS} builders at a time. ${ids.length} IDs were provided — remove ${ids.length - MAX_BUILDERS} to continue.`}
      />
    );
  }

  const searches = await prisma.search.findMany({
    where: { id: { in: ids } },
    select: {
      id: true,
      entityName: true,
      entityAbn: true,
      riskSummary: true,
      isDeepCheck: true,
      createdAt: true,
    },
  });

  // Preserve the order from the ids param; silently skip IDs that don't exist
  const columns: ComparisonData[] = ids
    .map((id) => searches.find((s) => s.id === id))
    .filter((s): s is NonNullable<typeof s> => s !== undefined)
    .map((s) => ({
      id: s.id,
      entityName: s.entityName,
      entityAbn: s.entityAbn,
      riskSummary: s.riskSummary,
      isDeepCheck: s.isDeepCheck,
      createdAt: s.createdAt.toISOString(),
    }));

  if (columns.length === 0) {
    return <ErrorPage message="No reports found for the provided IDs." />;
  }

  const gridClass =
    columns.length === 1
      ? 'grid-cols-1 max-w-sm'
      : columns.length === 2
        ? 'grid-cols-1 sm:grid-cols-2'
        : 'grid-cols-1 sm:grid-cols-2 lg:grid-cols-3';

  return (
    <main className="min-h-screen bg-background">
      <nav className="sticky top-0 z-20 bg-primary shadow-md" aria-label="Compare navigation">
        <div className="max-w-5xl mx-auto px-4 py-2">
          <Link
            href="/"
            className="text-white/70 hover:text-white text-xs font-semibold py-1.5 px-2 rounded transition"
          >
            ← New search
          </Link>
        </div>
      </nav>

      <div className="max-w-5xl mx-auto px-4 py-6">
        <div className="mb-6">
          <h1 className="text-xl font-bold text-primary">Builder Comparison</h1>
          <p className="text-sm text-text-secondary mt-1">
            Comparing {columns.length} builder{columns.length !== 1 ? 's' : ''} side-by-side
          </p>
        </div>

        <div className={`grid gap-4 ${gridClass}`}>
          {columns.map((col) => (
            <ComparisonColumn key={col.id} data={col} />
          ))}
        </div>

        <p className="text-xs text-text-muted mt-6 leading-relaxed">
          Comparison is based on stored report data at the time of each last search. Sections showing{' '}
          <strong>Clear</strong> indicate no automated risk signals were triggered — not that the
          section was checked and found clean. Click &ldquo;View full report&rdquo; to see full source
          evidence before making any commercial decision.
        </p>
      </div>
    </main>
  );
}
