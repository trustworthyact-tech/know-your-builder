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
      {/* Card header — split into link title + optional expand toggle */}
      <div className={`px-4 py-3 flex items-start gap-2 transition ${hasExtras ? 'hover:bg-surface-alt/50' : ''}`}>
        <div className="flex-1 min-w-0">
          {showJurisdiction && item.jurisdiction && (
            <span className="inline-block bg-info-bg text-info text-xs font-semibold px-2 py-0.5 rounded mb-1.5">
              {item.jurisdiction}
            </span>
          )}
          {item.url ? (
            <a
              href={item.url}
              target="_blank"
              rel="noopener noreferrer"
              className={`text-sm font-medium text-primary-light hover:text-primary hover:underline transition ${expanded ? '' : 'line-clamp-2'}`}
            >
              {item.title}
            </a>
          ) : (
            <p className={`text-sm font-medium text-text-primary ${expanded ? '' : 'line-clamp-2'}`}>
              {item.title}
            </p>
          )}
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
          <button
            type="button"
            onClick={() => setExpanded((e) => !e)}
            aria-expanded={expanded}
            aria-label={expanded ? 'Collapse details' : 'Expand details'}
            className="text-text-muted text-xs shrink-0 mt-0.5 p-1 hover:text-text-primary transition focus:outline-none focus-visible:ring-2 focus-visible:ring-primary rounded"
          >
            {expanded ? '▲' : '▼'}
          </button>
        )}
      </div>

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
        </div>
      )}
    </div>
  );
}
