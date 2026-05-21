'use client';

import { useState } from 'react';
import { ResultItem } from '@/src/types';

interface Props {
  item: ResultItem;
  showJurisdiction?: boolean;
}

export function ResultCard({ item, showJurisdiction }: Props) {
  const [expanded, setExpanded] = useState(false);
  const hasMetadata = item.metadata && Object.keys(item.metadata).length > 0;
  const hasExtras = hasMetadata || !!item.description;
  const isActive = item.status?.toLowerCase().includes('active');

  return (
    <div className="bg-surface rounded-xl border border-border shadow-sm mb-3 overflow-hidden">
      <button
        type="button"
        className={`w-full text-left px-4 py-3 flex items-start gap-2 transition focus:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-inset ${hasExtras ? 'hover:bg-surface-alt/50 cursor-pointer' : 'cursor-default'}`}
        onClick={hasExtras ? () => setExpanded((e) => !e) : undefined}
        aria-expanded={hasExtras ? expanded : undefined}
      >
        <div className="flex-1 min-w-0">
          {showJurisdiction && item.jurisdiction && (
            <span className="inline-block bg-info-bg text-info text-xs font-semibold px-2 py-0.5 rounded mb-1.5">
              {item.jurisdiction}
            </span>
          )}
          <p className={`text-sm font-medium text-text-primary ${expanded ? '' : 'line-clamp-2'}`}>
            {item.title}
          </p>
          {item.date && (
            <p className="text-xs text-text-muted mt-1">{item.date}</p>
          )}
          {item.status && (
            <span
              className={`inline-block text-xs font-semibold px-2 py-0.5 rounded mt-1.5 ${
                isActive ? 'bg-success-bg text-success' : 'bg-surface-alt text-text-secondary'
              }`}
            >
              {item.status}
            </span>
          )}
        </div>
        {hasExtras && (
          <span className="text-text-muted text-xs shrink-0 mt-0.5" aria-hidden="true">
            {expanded ? '▲' : '▼'}
          </span>
        )}
      </button>

      {expanded && (
        <div className="px-4 pb-4 border-t border-border-light">
          {item.description && (
            <p className="text-sm text-text-secondary mt-3">{item.description}</p>
          )}
          {hasMetadata && (
            <dl className="mt-3 divide-y divide-border-light">
              {Object.entries(item.metadata!).map(([k, v]) =>
                v ? (
                  <div key={k} className="flex justify-between py-1.5 gap-4">
                    <dt className="text-xs font-semibold text-text-secondary">{k}</dt>
                    <dd className="text-xs text-text-primary text-right">{v}</dd>
                  </div>
                ) : null
              )}
            </dl>
          )}
          {item.url && (
            <a
              href={item.url}
              target="_blank"
              rel="noopener noreferrer"
              aria-label={`View source for ${item.title} (opens in new tab)`}
              className="mt-3 inline-flex items-center gap-1 text-xs font-semibold text-primary-light hover:text-primary transition"
            >
              View source →
            </a>
          )}
        </div>
      )}

      {!hasExtras && item.url && (
        <div className="px-4 pb-3">
          <a
            href={item.url}
            target="_blank"
            rel="noopener noreferrer"
            aria-label={`Open ${item.title} (opens in new tab)`}
            className="text-xs font-semibold text-primary-light hover:text-primary transition"
          >
            Open →
          </a>
        </div>
      )}
    </div>
  );
}
