// Illustrative report layout for the hero (Linear-style product shot). It is
// labelled as an example and names no business. Replace with the redacted real
// NSW sample report once that fixture exists (planning doc: "Sample report").
import { SOURCE_COUNT } from '@/lib/marketing/content';

const ROWS = [
  { label: 'Builder licence', source: 'NSW Fair Trading', status: 'Current', tone: 'clear' },
  { label: 'ABN and company status', source: 'ABR · ASIC', status: 'Active', tone: 'clear' },
  { label: 'Insolvency notices', source: 'ASIC published notices', status: 'None found', tone: 'clear' },
  { label: 'Disqualified directors', source: 'ASIC register', status: 'None found', tone: 'clear' },
  { label: 'Court and tribunal decisions', source: 'NSW courts · NCAT', status: '2 found', tone: 'finding' },
  { label: 'Payment times', source: 'Payment Times Register', status: 'Not a reporter', tone: 'neutral' },
] as const;

// Darker text than the app's success/warning tokens: these chips are 12px and
// must clear 4.5:1 on their tinted backgrounds.
const chip: Record<(typeof ROWS)[number]['tone'], string> = {
  clear: 'bg-success-bg text-[#1B5E3B]',
  finding: 'bg-warning-bg text-[#7A3306]',
  neutral: 'bg-surface-alt text-text-secondary',
};

export function ReportPreview() {
  return (
    <figure className="relative mx-auto w-full max-w-md" aria-label="Example of a Know Your Builder report">
      <div className="overflow-hidden rounded-2xl border border-brand-line bg-white shadow-[0_24px_60px_-24px_rgba(11,37,69,0.35)]">
        <div className="flex items-center justify-between gap-3 border-b border-brand-line bg-brand-navy px-5 py-4 text-white">
          <div className="min-w-0">
            <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-[#C9D3E0]">Builder report</p>
            <p className="truncate text-base font-bold">
              <span className="rounded bg-white/15 px-1.5 text-transparent [text-shadow:0_0_8px_rgba(255,255,255,0.85)]" aria-hidden="true">
                Example Builders Pty Ltd
              </span>
              <span className="sr-only">Example builder</span>
            </p>
          </div>
          <span className="shrink-0 rounded-full bg-warning-bg px-3 py-1 text-xs font-bold text-[#7A3306]">1 finding</span>
        </div>
        <ul className="divide-y divide-brand-line">
          {ROWS.map((r) => (
            <li key={r.label} className="flex items-center justify-between gap-3 px-5 py-3">
              <div className="min-w-0">
                <p className="truncate text-sm font-semibold text-brand-navy">{r.label}</p>
                <p className="truncate text-xs text-brand-slate">{r.source}</p>
              </div>
              <span className={`shrink-0 rounded-full px-2.5 py-1 text-xs font-semibold ${chip[r.tone]}`}>{r.status}</span>
            </li>
          ))}
        </ul>
        <p className="border-t border-brand-line bg-brand-paper px-5 py-2.5 text-xs text-brand-slate">
          {SOURCE_COUNT} sources checked · every finding links to its source record
        </p>
      </div>
      <figcaption className="mt-3 text-center text-xs text-brand-slate">Example layout. Not a real business.</figcaption>
    </figure>
  );
}
