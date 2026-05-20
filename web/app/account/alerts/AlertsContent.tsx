'use client';

import { useState } from 'react';

// Mirror of the Prisma AlertType enum — defined locally to avoid bundling server code
type AlertType =
  | 'LICENCE_CHANGE'
  | 'INSOLVENCY_EVENT'
  | 'COURT_DECISION'
  | 'ATO_DEBT_FLAG'
  | 'QBCC_ADJUDICATION'
  | 'FWO_ENFORCEMENT';

export interface SerializedAlert {
  id: string;
  entityAbn: string;
  entityName: string;
  alertType: AlertType;
  description: string;
  read: boolean;
  createdAt: string;
}

const ALERT_TYPE_LABELS: Record<AlertType, string> = {
  LICENCE_CHANGE: 'Licence Change',
  INSOLVENCY_EVENT: 'Insolvency Notice',
  COURT_DECISION: 'Court Decision',
  ATO_DEBT_FLAG: 'ATO Tax Debt',
  QBCC_ADJUDICATION: 'QBCC Adjudication',
  FWO_ENFORCEMENT: 'Fair Work Enforcement',
};

const ALERT_TYPE_STYLES: Record<AlertType, string> = {
  LICENCE_CHANGE: 'text-amber-700 bg-amber-50 border-amber-200',
  INSOLVENCY_EVENT: 'text-red-700 bg-red-50 border-red-200',
  COURT_DECISION: 'text-purple-700 bg-purple-50 border-purple-200',
  ATO_DEBT_FLAG: 'text-orange-700 bg-orange-50 border-orange-200',
  QBCC_ADJUDICATION: 'text-blue-700 bg-blue-50 border-blue-200',
  FWO_ENFORCEMENT: 'text-rose-700 bg-rose-50 border-rose-200',
};

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString('en-AU', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  });
}

function reRunUrl(entityName: string, entityAbn: string): string {
  const params = new URLSearchParams({ companyName: entityName });
  if (entityAbn) params.set('abn', entityAbn);
  return `/search?${params.toString()}`;
}

export function AlertsContent({ alerts: initial }: { alerts: SerializedAlert[] }) {
  const [alerts, setAlerts] = useState(initial);
  const [tab, setTab] = useState<'unread' | 'all'>('unread');
  const [markingId, setMarkingId] = useState<string | null>(null);

  const unreadCount = alerts.filter((a) => !a.read).length;
  const displayed = tab === 'unread' ? alerts.filter((a) => !a.read) : alerts;

  async function markRead(id: string) {
    setMarkingId(id);
    try {
      const res = await fetch(`/api/alerts/${id}`, { method: 'PATCH' });
      if (res.ok) {
        setAlerts((prev) => prev.map((a) => (a.id === id ? { ...a, read: true } : a)));
      }
    } finally {
      setMarkingId(null);
    }
  }

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <div>
          <h2 className="text-lg font-semibold text-text-primary">Alerts</h2>
          <p className="text-sm text-text-muted mt-0.5">
            {unreadCount === 0
              ? 'No unread alerts'
              : `${unreadCount} unread alert${unreadCount !== 1 ? 's' : ''}`}
          </p>
        </div>
      </div>

      {/* Tab switcher */}
      <div className="flex border-b border-border-light mb-6">
        {(['unread', 'all'] as const).map((t) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors ${
              tab === t
                ? 'border-primary text-primary'
                : 'border-transparent text-text-secondary hover:text-text-primary'
            }`}
          >
            {t === 'unread' ? `Unread (${unreadCount})` : `All (${alerts.length})`}
          </button>
        ))}
      </div>

      {displayed.length === 0 ? (
        <div className="text-center py-16 bg-surface rounded-xl border border-border-light">
          <p className="text-text-muted text-sm">
            {tab === 'unread' ? 'No unread alerts.' : 'No alerts yet.'}
          </p>
        </div>
      ) : (
        <ul className="space-y-3">
          {displayed.map((alert) => (
            <li
              key={alert.id}
              className={`bg-surface border border-border-light rounded-xl p-4 flex flex-col sm:flex-row sm:items-start gap-3 transition-opacity ${
                alert.read ? 'opacity-60' : ''
              }`}
            >
              <div className="flex-1 min-w-0">
                <div className="flex flex-wrap items-center gap-2 mb-1">
                  <span
                    className={`inline-block text-xs font-semibold rounded px-2 py-0.5 border ${ALERT_TYPE_STYLES[alert.alertType]}`}
                  >
                    {ALERT_TYPE_LABELS[alert.alertType]}
                  </span>
                  {!alert.read && (
                    <span className="inline-block w-2 h-2 rounded-full bg-primary" aria-label="Unread" />
                  )}
                </div>
                <p className="text-sm font-semibold text-text-primary">{alert.entityName}</p>
                <p className="text-sm text-text-secondary mt-0.5">{alert.description}</p>
                <p className="text-xs text-text-muted mt-1">{formatDate(alert.createdAt)}</p>
              </div>

              <div className="flex sm:flex-col items-center sm:items-end gap-2 shrink-0">
                <a
                  href={reRunUrl(alert.entityName, alert.entityAbn)}
                  className="text-xs font-semibold text-white bg-primary rounded-lg px-3 py-1.5 hover:bg-primary-light transition-colors whitespace-nowrap"
                >
                  Re-run search ($3)
                </a>
                {!alert.read && (
                  <button
                    onClick={() => markRead(alert.id)}
                    disabled={markingId === alert.id}
                    className="text-xs text-text-muted hover:text-text-secondary transition-colors whitespace-nowrap disabled:opacity-50"
                  >
                    {markingId === alert.id ? 'Marking…' : 'Mark read'}
                  </button>
                )}
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
