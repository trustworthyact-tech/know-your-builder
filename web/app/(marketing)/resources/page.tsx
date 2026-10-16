import type { Metadata } from 'next';
import { PageHeader, SearchBand, h2Class } from '@/components/marketing/ui';
import { ResourceCard } from '@/components/marketing/ResourceCard';
import { RESOURCES, type ResourceType } from '@/lib/marketing/resources';

export const metadata: Metadata = {
  title: 'Resources: guides and templates for building and getting paid',
  description:
    'Plain-English guides and templates on checking builders, security of payment, home building insurance and what to do when a builder fails.',
  alternates: { canonical: '/resources' },
};

const SECTIONS: { type: ResourceType; title: string }[] = [
  { type: 'guide', title: 'Guides' },
  { type: 'template', title: 'Templates' },
  { type: 'blog', title: 'Articles' },
];

export default function ResourcesPage() {
  return (
    <>
      <PageHeader
        eyebrow="Resources"
        title="Guides for building, and for getting paid."
        lead="Plain-English guides and templates for homeowners, owner-builders and subcontractors. Every guide links to the official source behind it."
        crumbs={[
          { href: '/', label: 'Home' },
          { href: '/resources', label: 'Resources' },
        ]}
      />
      <div className="mx-auto grid max-w-6xl gap-14 px-4 py-14 sm:px-6">
        {SECTIONS.map(({ type, title }) => {
          const items = RESOURCES.filter((r) => r.type === type);
          if (items.length === 0) return null;
          return (
            <section key={type} aria-labelledby={`${type}-heading`} className="grid gap-6">
              <h2 id={`${type}-heading`} className={h2Class}>
                {title}
              </h2>
              <ul className="grid gap-5 md:grid-cols-2 lg:grid-cols-3">
                {items.map((r) => (
                  <li key={r.href}>
                    <ResourceCard r={r} />
                  </li>
                ))}
              </ul>
            </section>
          );
        })}
      </div>
      <SearchBand />
    </>
  );
}
