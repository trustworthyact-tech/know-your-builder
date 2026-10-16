import { PageHeader, Prose, SearchBand, JsonLd, breadcrumbJsonLd, type Crumb } from '@/components/marketing/ui';
import { CONTENT_REVIEWED, SITE_URL } from '@/lib/marketing/site';

interface Props {
  path: string;
  title: string;
  lead: string;
  section: { href: string; label: string };
  published: string;
  sources: { name: string; url: string }[];
  children: React.ReactNode;
}

// Shared shell for /resources guides: breadcrumbs, Article JSON-LD, a
// "last reviewed" line, the official sources the guide relies on, and the
// KYB search at the end.
export function Article({ path, title, lead, section, published, sources, children }: Props) {
  const crumbs: Crumb[] = [
    { href: '/', label: 'Home' },
    { href: '/resources', label: 'Resources' },
    { href: path, label: section.label },
  ];
  const reviewed = new Date(CONTENT_REVIEWED).toLocaleDateString('en-AU', { day: 'numeric', month: 'long', year: 'numeric' });

  return (
    <>
      <JsonLd data={breadcrumbJsonLd(SITE_URL, crumbs)} />
      <JsonLd
        data={{
          '@context': 'https://schema.org',
          '@type': 'Article',
          headline: title,
          description: lead,
          datePublished: published,
          dateModified: CONTENT_REVIEWED,
          mainEntityOfPage: `${SITE_URL}${path}`,
          publisher: { '@id': `${SITE_URL}/#organization` },
        }}
      />
      <PageHeader eyebrow={section.label} title={title} lead={lead} crumbs={crumbs} />
      <article className="mx-auto max-w-6xl px-4 py-12 sm:px-6">
        <Prose>
          {children}
          <h2>Sources</h2>
          <ul>
            {sources.map((s) => (
              <li key={s.url}>
                <a href={s.url} rel="noopener">
                  {s.name}
                </a>
              </li>
            ))}
          </ul>
          <p className="!mt-8 text-sm text-brand-slate">
            Last reviewed {reviewed}. This guide is general information, not legal advice. Rules change, so
            check the official sources above before you act.
          </p>
        </Prose>
      </article>
      <SearchBand />
    </>
  );
}
