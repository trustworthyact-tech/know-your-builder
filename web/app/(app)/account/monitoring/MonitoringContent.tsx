'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { MonitoringSubscribeModal } from '@/components/MonitoringSubscribeModal';

export interface SerializedMonitoringSubscription {
  id: string;
  entityName: string;
  entityAbn: string;
  nextDailyCheck: string;
  nextMonthlyCheck: string;
  createdAt: string;
}

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString('en-AU', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  });
}

export function MonitoringContent({
  subscriptions: initial,
}: {
  subscriptions: SerializedMonitoringSubscription[];
}) {
  const router = useRouter();
  const [subscriptions, setSubscriptions] = useState(initial);
  const [showAddModal, setShowAddModal] = useState(false);
  const [cancellingId, setCancellingId] = useState<string | null>(null);
  const [cancelError, setCancelError] = useState<string | null>(null);

  async function handleCancel(id: string) {
    setCancellingId(id);
    setCancelError(null);
    try {
      const res = await fetch('/api/monitoring', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id }),
      });
      if (res.ok) {
        setSubscriptions((prev) => prev.filter((s) => s.id !== id));
      } else {
        const data = await res.json();
        setCancelError(data.error ?? 'Failed to cancel');
      }
    } catch {
      setCancelError('Failed to cancel');
    } finally {
      setCancellingId(null);
    }
  }

  function handleSubscribeSuccess() {
    setShowAddModal(false);
    router.refresh();
  }

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <div>
          <h2 className="text-lg font-semibold text-text-primary">Monitoring</h2>
          <p className="text-sm text-text-muted mt-0.5">
            {subscriptions.length === 0
              ? 'No active subscriptions'
              : `${subscriptions.length} active subscription${subscriptions.length !== 1 ? 's' : ''} · $18/month each`}
          </p>
        </div>
        <button
          onClick={() => setShowAddModal(true)}
          className="text-sm font-semibold bg-primary text-white rounded-lg px-4 py-2 hover:bg-primary-light transition-colors"
        >
          + Monitor a builder
        </button>
      </div>

      {cancelError && (
        <p className="text-sm text-danger bg-danger-bg rounded px-3 py-2 mb-4">{cancelError}</p>
      )}

      {subscriptions.length === 0 ? (
        <div className="text-center py-16 bg-surface rounded-xl border border-border-light">
          <p className="text-text-muted text-sm max-w-sm mx-auto">
            Monitor a builder to get alerted when their licence, court, or insolvency status changes.
          </p>
          <button
            onClick={() => setShowAddModal(true)}
            className="mt-4 inline-block text-sm font-semibold text-primary hover:underline"
          >
            Start monitoring →
          </button>
        </div>
      ) : (
        <ul className="space-y-3">
          {subscriptions.map((sub) => (
            <li
              key={sub.id}
              className="bg-surface border border-border-light rounded-xl p-4 flex flex-col sm:flex-row sm:items-center gap-4"
            >
              <div className="flex-1 min-w-0">
                <p className="text-base font-semibold text-text-primary truncate">{sub.entityName}</p>
                <div className="flex flex-wrap items-center gap-x-3 gap-y-1 mt-1">
                  {sub.entityAbn && (
                    <span className="text-xs text-text-muted">ABN {sub.entityAbn}</span>
                  )}
                  <span className="text-xs text-text-muted">
                    Next check: {formatDate(sub.nextDailyCheck)}
                  </span>
                  <span className="text-xs text-text-muted">
                    Monthly report: {formatDate(sub.nextMonthlyCheck)}
                  </span>
                </div>
              </div>

              <button
                onClick={() => handleCancel(sub.id)}
                disabled={cancellingId === sub.id}
                className="shrink-0 text-xs font-semibold text-danger border border-danger/40 rounded-lg px-3 py-1.5 hover:bg-danger-bg transition-colors disabled:opacity-50"
              >
                {cancellingId === sub.id ? 'Cancelling…' : 'Cancel subscription'}
              </button>
            </li>
          ))}
        </ul>
      )}

      {showAddModal && (
        <MonitoringSubscribeModal
          onSuccess={handleSubscribeSuccess}
          onClose={() => setShowAddModal(false)}
        />
      )}
    </div>
  );
}
