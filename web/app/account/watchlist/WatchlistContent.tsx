'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { RiskBadge, RiskLevel } from '@/components/RiskBadge';
import { PaymentModal } from '@/components/PaymentModal';
import type { RiskGroupResult } from '@/src/types';

export interface SerializedWatchlistItem {
  id: string;
  entityName: string;
  entityAbn: string;
  createdAt: string;
  lastSearch: {
    id: string;
    createdAt: string;
    riskSummary: string | null;
    isDeepCheck: boolean;
  } | null;
}

function getRiskLevel(riskSummary: string | null): RiskLevel {
  if (!riskSummary) return 'unavailable';
  try {
    const groups: RiskGroupResult[] = JSON.parse(riskSummary);
    if (groups.some((g) => g.severity === 'significant')) return 'significant';
    if (groups.length > 0) return 'findings';
    return 'clear';
  } catch {
    return 'unavailable';
  }
}

const STALE_DAYS = 30;

function buildSearchUrl(entityName: string, entityAbn: string): string {
  const p = new URLSearchParams();
  p.set('companyName', entityName);
  if (entityAbn) p.set('abn', entityAbn);
  return `/search?${p}`;
}

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString('en-AU', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  });
}

export function WatchlistContent({
  items: initial,
  freeChecks = 0,
}: {
  items: SerializedWatchlistItem[];
  freeChecks?: number;
}) {
  const router = useRouter();
  const [items, setItems] = useState(initial);
  const [removingId, setRemovingId] = useState<string | null>(null);
  const [removeError, setRemoveError] = useState<string | null>(null);
  const [recheckItem, setRecheckItem] = useState<SerializedWatchlistItem | null>(null);

  async function handleRemove(item: SerializedWatchlistItem) {
    setRemovingId(item.id);
    setRemoveError(null);
    try {
      const res = await fetch('/api/watchlist', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ entityAbn: item.entityAbn }),
      });
      if (res.ok) {
        setItems((prev) => prev.filter((i) => i.id !== item.id));
      } else {
        const data = await res.json();
        setRemoveError(data.error ?? 'Failed to remove');
      }
    } catch {
      setRemoveError('Failed to remove');
    } finally {
      setRemovingId(null);
    }
  }

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <div>
          <h2 className="text-lg font-semibold text-text-primary">Watchlist</h2>
          <p className="text-sm text-text-muted mt-0.5">
            {items.length === 0
              ? 'No builders on your watchlist'
              : `${items.length} builder${items.length !== 1 ? 's' : ''} saved`}
            {freeChecks > 0 && (
              <span className="ml-2 text-success font-medium">
                · {freeChecks} re-check credit{freeChecks !== 1 ? 's' : ''} available
              </span>
            )}
          </p>
        </div>
      </div>

      {removeError && (
        <p className="text-sm text-danger bg-danger-bg rounded px-3 py-2 mb-4">{removeError}</p>
      )}

      {items.length === 0 ? (
        <div className="text-center py-16 bg-surface rounded-xl border border-border-light">
          <p className="text-text-muted text-sm max-w-sm mx-auto">
            Add builders to your watchlist from any report to quickly re-check them later.
          </p>
          <Link
            href="/"
            className="mt-4 inline-block text-sm font-semibold text-primary hover:underline"
          >
            Run a search →
          </Link>
        </div>
      ) : (
        <ul className="space-y-3">
          {items.map((item) => {
            const riskLevel = getRiskLevel(item.lastSearch?.riskSummary ?? null);
            const lastCheckedIso = item.lastSearch?.createdAt ?? item.createdAt;
            const daysSince = Math.floor(
              (Date.now() - new Date(lastCheckedIso).getTime()) / (1000 * 60 * 60 * 24)
            );
            const isStale = daysSince >= STALE_DAYS;

            return (
              <li
                key={item.id}
                className="bg-surface border border-border-light rounded-xl p-4 flex flex-col sm:flex-row sm:items-center gap-4"
              >
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <p className="text-base font-semibold text-text-primary truncate">
                      {item.entityName}
                    </p>
                    <RiskBadge level={riskLevel} />
                    {isStale && (
                      <span className="text-xs text-warning bg-warning-bg rounded px-1.5 py-0.5">
                        {daysSince}d old
                      </span>
                    )}
                  </div>
                  <div className="flex flex-wrap items-center gap-x-3 gap-y-1 mt-1">
                    {item.entityAbn && (
                      <span className="text-xs text-text-muted">ABN {item.entityAbn}</span>
                    )}
                    <span className="text-xs text-text-muted">
                      Last checked: {formatDate(lastCheckedIso)}
                    </span>
                    {item.lastSearch && (
                      <Link
                        href={`/report/${item.lastSearch.id}`}
                        className="text-xs text-primary hover:underline"
                      >
                        View report →
                      </Link>
                    )}
                  </div>
                </div>

                <div className="flex items-center gap-2 shrink-0">
                  {freeChecks > 0 ? (
                    <Link
                      href={buildSearchUrl(item.entityName, item.entityAbn)}
                      className="text-xs font-semibold text-white bg-primary rounded-lg px-3 py-1.5 hover:bg-primary-light transition-colors"
                    >
                      Re-check ({freeChecks})
                    </Link>
                  ) : (
                    <button
                      onClick={() => setRecheckItem(item)}
                      className="text-xs font-semibold text-primary border border-primary/40 rounded-lg px-3 py-1.5 hover:bg-primary/5 transition-colors"
                    >
                      Re-check $3
                    </button>
                  )}
                  <button
                    onClick={() => handleRemove(item)}
                    disabled={removingId === item.id}
                    className="text-xs font-semibold text-danger border border-danger/40 rounded-lg px-3 py-1.5 hover:bg-danger-bg transition-colors disabled:opacity-50"
                  >
                    {removingId === item.id ? 'Removing…' : 'Remove'}
                  </button>
                </div>
              </li>
            );
          })}
        </ul>
      )}

      {recheckItem && (
        <PaymentModal
          paymentType="RECHECK_SINGLE"
          onSuccess={() => {
            const item = recheckItem;
            setRecheckItem(null);
            router.push(buildSearchUrl(item.entityName, item.entityAbn));
          }}
          onClose={() => setRecheckItem(null)}
        />
      )}
    </div>
  );
}
