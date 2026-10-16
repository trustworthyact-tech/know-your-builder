import Link from 'next/link';
import { SAMPLE_FINDINGS, SAMPLE_REPORT } from '@/lib/marketing/sampleReport';
import { toneChip } from '@/components/marketing/SampleReport';

// Hero product shot (Linear-style): a condensed view of the real, redacted
// sample report, linking through to the full expandable version.
export function ReportPreview() {
  const r = SAMPLE_REPORT;
  return (
    <figure className="relative mx-auto w-full max-w-md">
      <div className="overflow-hidden rounded-2xl border border-brand-line bg-white shadow-[0_24px_60px_-24px_rgba(11,37,69,0.35)]">
        <div className="flex items-center justify-between gap-3 border-b border-brand-line bg-brand-navy px-5 py-4 text-white">
          <div className="min-w-0">
            <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-[#C9D3E0]">Builder report</p>
            <p className="truncate text-base font-bold">
              <span className="rounded bg-white/15 px-1.5 text-transparent [text-shadow:0_0_8px_rgba(255,255,255,0.85)]" aria-hidden="true">
                Builder name removed
              </span>
              <span className="sr-only">{r.entityLabel}, name removed</span>
            </p>
          </div>
          <span className="shrink-0 rounded-full bg-warning-bg px-3 py-1 text-xs font-bold text-[#7A3306]">
            {SAMPLE_FINDINGS} findings
          </span>
        </div>
        <ul className="divide-y divide-brand-line">
          {r.sections.map((s) => (
            <li key={s.id} className="flex items-center justify-between gap-3 px-5 py-3">
              <div className="min-w-0">
                <p className="truncate text-sm font-semibold text-brand-navy">{s.title}</p>
                <p className="truncate text-xs text-brand-slate">{s.sources.map((x) => x.name).slice(0, 2).join(' · ')}</p>
              </div>
              <span className={`shrink-0 rounded-full px-2.5 py-1 text-xs font-semibold ${toneChip[s.tone]}`}>{s.short}</span>
            </li>
          ))}
        </ul>
        <p className="border-t border-brand-line bg-brand-paper px-5 py-2.5 text-xs text-brand-slate">
          {r.sourcesChecked} sources checked · every finding links to its source record
        </p>
      </div>
      <figcaption className="mt-3 text-center text-xs text-brand-slate">
        A real NSW report, identifying details removed.{' '}
        <Link href="/sample-report" className="font-semibold text-brand-navy underline decoration-brand-ochre decoration-2 underline-offset-4">
          Open the full sample
        </Link>
      </figcaption>
    </figure>
  );
}
