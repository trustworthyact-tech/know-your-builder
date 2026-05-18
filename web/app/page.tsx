import { SearchBar } from '@/components/SearchBar';

const CHECKLIST = [
  ['🏛', 'ABR, ASIC & company notices'],
  ['💳', 'Payment Times Reporting Register'],
  ['⚖️', 'Federal & all state/territory courts'],
  ['🏗', 'QBCC, NSW Fair Trading & state licence registers'],
  ['🔍', 'Modern Slavery & WGEA registers'],
  ['📋', '40+ court, tribunal & regulatory databases'],
] as const;

export default function HomePage() {
  return (
    <main className="min-h-screen bg-background">
      <div className="max-w-xl mx-auto px-4 pt-14 pb-16">
        {/* Hero */}
        <div className="text-center mb-8">
          <div className="w-16 h-16 rounded-full bg-primary flex items-center justify-center mx-auto mb-4 shadow-md">
            <span className="text-white font-extrabold text-xl tracking-tight">KYB</span>
          </div>
          <h1 className="text-3xl font-bold text-primary mb-2">Know Your Builder</h1>
          <p className="text-sm text-text-secondary max-w-xs mx-auto">
            Automated due diligence across 40+ Australian government databases
          </p>
        </div>

        {/* Search form */}
        <SearchBar />

        {/* Contract upload stub */}
        <div className="mt-4 text-center">
          <button
            type="button"
            className="text-sm text-primary-light font-medium underline underline-offset-2 hover:text-primary transition"
            aria-label="Upload a building contract to extract builder details automatically"
          >
            Or upload your contract to auto-fill →
          </button>
        </div>

        {/* What we check */}
        <div className="mt-8 bg-surface rounded-2xl p-6 border border-border shadow-sm">
          <h2 className="text-base font-semibold text-primary mb-4">What we search</h2>
          <ul className="space-y-2.5">
            {CHECKLIST.map(([icon, text]) => (
              <li key={text} className="flex items-start gap-3">
                <span className="text-base w-6 shrink-0">{icon}</span>
                <span className="text-sm text-text-secondary">{text}</span>
              </li>
            ))}
          </ul>
        </div>

        {/* Disclaimer */}
        <div className="mt-4 bg-warning-bg border-l-4 border-accent rounded-lg px-4 py-3">
          <p className="text-xs text-warning leading-relaxed">
            This tool searches publicly available databases only. Results should be verified
            and do not constitute legal or financial advice. Some records may not appear if
            the entity has not been involved in relevant proceedings.
          </p>
        </div>
      </div>
    </main>
  );
}
