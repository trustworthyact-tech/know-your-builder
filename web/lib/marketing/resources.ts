// Index of /resources content (principle 3: one hub, new content is a new
// file plus an entry here — no navigation changes). Newest first.
// Blog posts get a 'blog' type and a /resources/blog/[slug] route when the
// first post is written; the hub shows only types that have entries.

export type ResourceType = 'guide' | 'template' | 'blog';

export interface Resource {
  type: ResourceType;
  href: string;
  title: string;
  description: string;
  published: string; // YYYY-MM-DD
}

export const RESOURCES: Resource[] = [
  {
    type: 'guide',
    href: '/resources/guides/builder-gone-into-liquidation-nsw',
    title: 'Your builder has gone into liquidation: what to do in NSW',
    description: 'First steps for homeowners and subcontractors, and how the Home Building Compensation Fund works.',
    published: '2026-10-16',
  },
  {
    type: 'guide',
    href: '/resources/guides/security-of-payment-act-nsw',
    title: 'The NSW Security of Payment Act, explained',
    description: 'Payment claims, payment schedules and the deadlines that apply to builders and subcontractors in NSW.',
    published: '2026-10-16',
  },
  {
    type: 'guide',
    href: '/resources/guides/home-building-insurance-by-state',
    title: 'Home building insurance by state',
    description: 'When a builder must insure residential work in each state and territory, and what to ask for before paying a deposit.',
    published: '2026-10-16',
  },
  {
    type: 'template',
    href: '/resources/templates/builder-check-checklist',
    title: 'Builder check checklist',
    description: 'Ten things to check before you sign a building contract or subcontract.',
    published: '2026-10-16',
  },
];

export const TYPE_LABELS: Record<ResourceType, string> = {
  guide: 'Guide',
  template: 'Template',
  blog: 'Article',
};
