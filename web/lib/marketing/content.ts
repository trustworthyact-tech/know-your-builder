// Marketing-site copy that more than one section (or the JSON-LD) reads.
//
// SOURCE_GROUPS must describe exactly the launch-scope searches — the 16
// `mvpScope: true` entries in server/scrapers/manifest.js (national + NSW + ACT,
// see CLAUDE.md "Launch scope"). If scope changes, update this list too: the
// homepage stats strip counts it.

export interface SourceGroup {
  id: string;
  title: string;
  summary: string;
  sources: string[];
  limits: string;
}

export const SOURCE_GROUPS: SourceGroup[] = [
  {
    id: 'licences',
    title: 'Builder licences and discipline',
    summary:
      'Whether the builder holds a current licence, its class and expiry, and any disciplinary action or compliance history recorded against it.',
    sources: [
      'NSW contractor licence register (Verify licence)',
      'Access Canberra builder licence register',
      'Access Canberra register of disciplinary actions',
    ],
    limits: 'Licence checks cover NSW and the ACT only in this release.',
  },
  {
    id: 'identity',
    title: 'Business identity',
    summary:
      'That the ABN is active and matches the business you are dealing with, the company’s registration status, and other companies its directors are linked to.',
    sources: ['Australian Business Register (ABR)', 'ASIC company register', 'ASIC director company history'],
    limits: 'Director history needs a director’s name, which you can add on the full search form.',
  },
  {
    id: 'financial',
    title: 'Financial warning signs',
    summary:
      'Liquidation, administration and other insolvency notices, published tax-debt notices, and how long the business takes to pay its own suppliers.',
    sources: [
      'ASIC published notices: insolvency',
      'ASIC published notices: ATO tax debt',
      'Payment Times Reporting Register',
    ],
    limits: 'Payment times are only reported by large businesses, so most small builders won’t appear.',
  },
  {
    id: 'enforcement',
    title: 'Regulator enforcement',
    summary:
      'Directors banned from managing companies, undertakings given to ASIC, and Fair Work Ombudsman enforcement outcomes.',
    sources: [
      'ASIC disqualified persons register',
      'ASIC court enforceable undertakings register',
      'Fair Work Ombudsman enforcement outcomes',
    ],
    limits: 'Records appear once the regulator publishes them, which can lag behind the event.',
  },
  {
    id: 'courts',
    title: 'Courts and tribunals',
    summary:
      'Published judgments and tribunal decisions naming the business, including building disputes heard in NCAT and ACAT.',
    sources: ['Federal courts', 'NSW courts and tribunals', 'ACT courts and ACAT'],
    limits: 'Only published decisions are searchable. Cases that settle or are still running may not appear.',
  },
  {
    id: 'ethics',
    title: 'Supply-chain statements',
    summary: 'Whether the business has lodged a modern slavery statement.',
    sources: ['Modern Slavery Statements Register'],
    limits: 'Only businesses with A$100 million or more in revenue must report.',
  },
];

export const SOURCE_COUNT = SOURCE_GROUPS.reduce((n, g) => n + g.sources.length, 0);

export const FAQS = [
  {
    q: 'How do I check a builder’s licence in NSW?',
    a: 'Building Commission NSW publishes contractor licences on the NSW Government’s Verify licence service, where you can search by name or licence number. Know Your Builder checks that register for you, includes any compliance history recorded against the licence, and adds ASIC, insolvency and court checks in the same report.',
  },
  {
    q: 'How do I check a builder’s licence in the ACT?',
    a: 'Access Canberra publishes the ACT’s builder licence register and a separate register of disciplinary actions. Know Your Builder searches both, so a suspension or condition shows up alongside the licence status.',
  },
  {
    q: 'Is the report really free?',
    a: 'Yes. Enter the builder’s name or ABN and the check runs at no cost. We ask for your email address so we can send you a link to the report.',
  },
  {
    q: 'My builder works outside NSW and the ACT. Can I still use it?',
    a: 'Not yet. This release covers NSW and the ACT. Until other states are added, check the builder’s licence on your state regulator’s register and confirm their insurance before you pay a deposit.',
  },
  {
    q: 'Does a clean report mean the builder is safe to use?',
    a: 'No. A clean report means nothing was found in the sources we checked on the day you searched. Registers can lag behind events, so also check references, home building insurance and your contract before you sign.',
  },
  {
    q: 'Where does the information come from?',
    a: `From ${SOURCE_COUNT} official public registers, courts and tribunals. Every finding in the report links back to the record it came from, so you can check it yourself.`,
  },
] as const;
