import type { Metadata } from 'next';
import { Article } from '@/components/marketing/Article';

const path = '/resources/templates/builder-check-checklist';
const title = 'Builder check checklist';
const lead = 'Ten checks to tick off before you sign a building contract or subcontract. Copy it into your notes or print it.';

export const metadata: Metadata = {
  title: 'Builder check checklist: 10 things to check before you sign',
  description:
    'A free checklist for homeowners, owner-builders and subcontractors: licence, ABN, insurance, insolvency notices, court history and more, before you sign.',
  alternates: { canonical: path },
};

const CHECKS: { group: string; items: string[] }[] = [
  {
    group: 'The business',
    items: [
      'The ABN is active and belongs to the business named on the contract (ABN Lookup).',
      'The licence is current, covers this type of work, and is held by the same business or person.',
      'There’s no disciplinary action, suspension or condition on the licence that affects your job.',
    ],
  },
  {
    group: 'Financial health',
    items: [
      'No liquidation, administration or winding-up notices on ASIC’s published notices.',
      'No ATO tax-debt notices or recent payment disputes.',
      'The directors aren’t linked to a string of failed companies.',
    ],
  },
  {
    group: 'Track record',
    items: [
      'You’ve read any court or tribunal decisions naming the business (NCAT, ACAT, local courts).',
      'You’ve spoken to two or three recent clients or trades who worked for them.',
    ],
  },
  {
    group: 'The paperwork',
    items: [
      'Home building insurance is in place and you have the certificate, where your state requires it.',
      'The deposit is within your state’s limit, and the contract has been reviewed before you sign.',
    ],
  },
];

export default function Page() {
  return (
    <Article
      path={path}
      title={title}
      lead={lead}
      section={{ href: path, label: 'Template' }}
      published="2026-10-16"
      sources={[
        { name: 'ABN Lookup', url: 'https://abr.business.gov.au/' },
        { name: 'ASIC published notices', url: 'https://publishednotices.asic.gov.au/' },
        { name: 'Builder licence registers by state', url: '/check-builder-licence' },
      ]}
    >
      <p>
        In NSW and the ACT, a <a href="/check">free Know Your Builder report</a> covers most of the first seven checks (director history needs the director’s name, which you can add on the full search form)
        in one go.
      </p>
      {CHECKS.map((c) => (
        <div key={c.group}>
          <h2>{c.group}</h2>
          <ul className="!list-none !pl-0">
            {c.items.map((item) => (
              <li key={item} className="flex gap-3">
                <span aria-hidden="true" className="mt-1.5 h-4 w-4 shrink-0 rounded border-2 border-brand-navy" />
                <span>{item}</span>
              </li>
            ))}
          </ul>
        </div>
      ))}
    </Article>
  );
}
