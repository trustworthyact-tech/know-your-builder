import Link from 'next/link';
import { HeroSearch } from '@/components/marketing/HeroSearch';

// Shared building blocks for marketing pages (Server Components).

export const eyebrowClass = 'text-xs font-semibold uppercase tracking-[0.14em] text-brand-ochre-text';
export const h2Class = 'text-3xl font-extrabold tracking-tight text-brand-navy sm:text-4xl [text-wrap:balance]';

export interface Crumb {
  href: string;
  label: string;
}

export function Breadcrumbs({ items }: { items: Crumb[] }) {
  return (
    <nav aria-label="Breadcrumb" className="text-sm text-brand-slate">
      <ol className="flex flex-wrap items-center gap-1.5">
        {items.map((c, i) => (
          <li key={c.href} className="flex items-center gap-1.5">
            {i > 0 && <span aria-hidden="true">/</span>}
            {i === items.length - 1 ? (
              <span aria-current="page" className="text-brand-navy">
                {c.label}
              </span>
            ) : (
              <Link href={c.href} className="rounded hover:text-brand-navy focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-navy">
                {c.label}
              </Link>
            )}
          </li>
        ))}
      </ol>
    </nav>
  );
}

export function breadcrumbJsonLd(site: string, items: Crumb[]) {
  return {
    '@context': 'https://schema.org',
    '@type': 'BreadcrumbList',
    itemListElement: items.map((c, i) => ({
      '@type': 'ListItem',
      position: i + 1,
      name: c.label,
      item: `${site}${c.href}`,
    })),
  };
}

export function JsonLd({ data }: { data: unknown }) {
  return <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(data) }} />;
}

export function PageHeader({
  eyebrow,
  title,
  lead,
  crumbs,
  children,
}: {
  eyebrow?: string;
  title: string;
  lead?: string;
  crumbs?: Crumb[];
  children?: React.ReactNode;
}) {
  return (
    <header className="relative overflow-hidden border-b border-brand-line">
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-0 bg-[radial-gradient(ellipse_at_10%_0%,#FBEFD9_0%,rgba(251,239,217,0)_55%)]"
      />
      <div className="relative mx-auto grid max-w-6xl gap-5 px-4 pb-12 pt-10 sm:px-6 lg:pb-16 lg:pt-14">
        {crumbs && <Breadcrumbs items={crumbs} />}
        {eyebrow && <p className={eyebrowClass}>{eyebrow}</p>}
        <h1 className="max-w-3xl text-4xl font-extrabold leading-[1.08] tracking-tight text-brand-navy sm:text-5xl [text-wrap:balance]">
          {title}
        </h1>
        {lead && <p className="max-w-2xl text-lg leading-relaxed text-brand-slate">{lead}</p>}
        {children}
      </div>
    </header>
  );
}

// Long-form reading column. Styles plain HTML children (h2, p, ul, ol, a,
// table) so content pages can be written as ordinary JSX.
export function Prose({ children }: { children: React.ReactNode }) {
  return (
    <div
      className={[
        'max-w-[68ch] text-[17px] leading-[1.7] text-[#2B3A4F]',
        '[&_h2]:mt-12 [&_h2]:text-2xl [&_h2]:font-extrabold [&_h2]:tracking-tight [&_h2]:text-brand-navy [&_h2]:[text-wrap:balance]',
        '[&_h3]:mt-8 [&_h3]:text-lg [&_h3]:font-bold [&_h3]:text-brand-navy',
        '[&_p]:mt-4 [&_ul]:mt-4 [&_ol]:mt-4 [&_ul]:list-disc [&_ol]:list-decimal [&_ul]:pl-6 [&_ol]:pl-6 [&_li]:mt-2',
        '[&_a]:font-semibold [&_a]:text-brand-navy [&_a]:underline [&_a]:decoration-brand-ochre [&_a]:decoration-2 [&_a]:underline-offset-4 hover:[&_a]:decoration-brand-navy',
        '[&_strong]:text-brand-navy',
        '[&_table]:mt-6 [&_table]:w-full [&_table]:border-collapse [&_table]:text-[15px] [&_th]:border-b [&_th]:border-brand-line [&_th]:py-2 [&_th]:pr-4 [&_th]:text-left [&_th]:font-semibold [&_th]:text-brand-navy [&_td]:border-b [&_td]:border-brand-line [&_td]:py-2 [&_td]:pr-4 [&_td]:align-top',
      ].join(' ')}
    >
      {children}
    </div>
  );
}

export function Callout({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <aside className="mt-8 rounded-2xl border border-brand-line bg-brand-wash/60 p-5">
      <p className="font-bold text-brand-navy">{title}</p>
      <div className="mt-1 text-[15px] leading-relaxed text-[#2B3A4F]">{children}</div>
    </aside>
  );
}

// The KYB search as a band — the closing CTA on every content page.
export function SearchBand({
  title = 'Check your builder before you sign.',
  sub = 'Free report. NSW and ACT builders.',
}: {
  title?: string;
  sub?: string;
}) {
  return (
    <section aria-label="Check a builder" className="px-4 py-16 sm:px-6">
      <div className="relative mx-auto max-w-6xl overflow-hidden rounded-3xl bg-brand-navy px-6 py-12 text-center sm:px-12">
        <div
          aria-hidden="true"
          className="pointer-events-none absolute inset-0 bg-[radial-gradient(ellipse_at_50%_120%,rgba(216,138,0,0.35)_0%,rgba(216,138,0,0)_60%)]"
        />
        <div className="relative mx-auto grid max-w-2xl gap-5">
          <h2 className="text-3xl font-extrabold tracking-tight text-white [text-wrap:balance]">{title}</h2>
          <p className="text-[#C9D3E0]">{sub}</p>
          <HeroSearch source="closing" tone="dark" />
        </div>
      </div>
    </section>
  );
}
