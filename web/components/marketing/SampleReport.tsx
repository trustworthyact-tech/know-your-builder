import { REDACTED, SAMPLE_FINDINGS, SAMPLE_REPORT, type SampleTone } from '@/lib/marketing/sampleReport';

// Click-to-expand sample report (principle 4) using native <details>, so it
// needs no JavaScript. Data is a real report with identifying details removed.

export const toneChip: Record<SampleTone, string> = {
  clear: 'bg-success-bg text-[#1B5E3B]',
  finding: 'bg-warning-bg text-[#7A3306]',
  info: 'bg-surface-alt text-text-secondary',
};
const toneLabel: Record<SampleTone, string> = { clear: 'Clear', finding: 'Findings', info: 'For information' };

export function Redacted() {
  return (
    <span className="inline-block select-none rounded bg-brand-line px-1.5 text-transparent [text-shadow:0_0_7px_rgba(11,37,69,0.55)]">
      <span aria-hidden="true">Removed for privacy</span>
      <span className="sr-only">Removed for privacy</span>
    </span>
  );
}

function Value({ v }: { v: string }) {
  return v === REDACTED ? <Redacted /> : <>{v}</>;
}

export function SampleReport() {
  const r = SAMPLE_REPORT;
  return (
    <div className="overflow-hidden rounded-2xl border border-brand-line bg-white shadow-[0_24px_60px_-28px_rgba(11,37,69,0.35)]">
      <div className="flex flex-wrap items-center justify-between gap-3 bg-brand-navy px-6 py-5 text-white">
        <div className="grid gap-1">
          <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-[#C9D3E0]">Know Your Builder report</p>
          <p className="text-lg font-bold">
            <span className="rounded bg-white/15 px-2 text-transparent [text-shadow:0_0_8px_rgba(255,255,255,0.85)]" aria-hidden="true">
              Builder name removed
            </span>
            <span className="sr-only">Builder name removed for privacy</span>
          </p>
          <p className="text-sm text-[#C9D3E0]">
            {r.entityLabel} · searched {r.searchedOn} · {r.sourcesChecked} sources checked
          </p>
        </div>
        <span className="rounded-full bg-warning-bg px-3 py-1 text-sm font-bold text-[#7A3306]">
          {SAMPLE_FINDINGS} sections with findings
        </span>
      </div>

      <div className="divide-y divide-brand-line">
        {r.sections.map((s, i) => (
          <details key={s.id} className="group" open={i === 0}>
            <summary className="flex cursor-pointer list-none items-start justify-between gap-4 px-6 py-5 focus:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-brand-navy [&::-webkit-details-marker]:hidden">
              <span className="grid gap-1">
                <span className="text-base font-bold text-brand-navy">{s.title}</span>
                <span className="text-sm text-brand-slate">{s.headline}</span>
              </span>
              <span className="flex shrink-0 items-center gap-3">
                <span className={`rounded-full px-2.5 py-1 text-xs font-semibold ${toneChip[s.tone]}`}>{toneLabel[s.tone]}</span>
                <svg aria-hidden="true" viewBox="0 0 20 20" className="h-5 w-5 text-brand-navy transition-transform group-open:rotate-180 motion-reduce:transition-none">
                  <path d="M5 8l5 5 5-5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
              </span>
            </summary>
            <div className="grid gap-5 bg-brand-paper/60 px-6 pb-6 pt-1">
              <ul className="grid gap-2 sm:grid-cols-2">
                {s.sources.map((src) => (
                  <li key={src.name} className="flex items-center justify-between gap-3 rounded-lg border border-brand-line bg-white px-3 py-2">
                    <span className="min-w-0 text-sm text-brand-navy">{src.name}</span>
                    <span className={`shrink-0 rounded-full px-2 py-0.5 text-xs font-semibold ${toneChip[src.tone]}`}>{src.result}</span>
                  </li>
                ))}
              </ul>
              {s.items.map((it) => (
                <div key={it.title} className="grid gap-2 rounded-xl border border-brand-line bg-white p-4">
                  <p className="font-semibold text-brand-navy">{it.title}</p>
                  {it.detail && <p className="text-sm leading-relaxed text-brand-slate">{it.detail}</p>}
                  <dl className="grid gap-x-6 gap-y-1.5 text-sm sm:grid-cols-[auto_1fr]">
                    {it.facts.map(([k, v]) => (
                      <div key={k} className="contents">
                        <dt className="text-brand-slate">{k}</dt>
                        <dd className="text-brand-navy">
                          <Value v={v} />
                        </dd>
                      </div>
                    ))}
                  </dl>
                </div>
              ))}
            </div>
          </details>
        ))}
      </div>
      <p className="border-t border-brand-line bg-brand-paper px-6 py-3 text-xs text-brand-slate">
        A real report with the builder’s name and other identifying details removed. In a live report every
        finding links to its source record.
      </p>
    </div>
  );
}
