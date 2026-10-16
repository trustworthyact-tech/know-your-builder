// Sample report for the marketing site: a REAL Know Your Builder report for a
// large NSW residential builder, run against production on 2026-10-16, with
// every identifying detail removed by hand before it was written here — the
// business and any other company names, people's names, ABN/ACN, licence
// numbers, case names and citations, source URLs, and exact dates (coarsened to
// years). Nothing in this file identifies the builder; don't add anything that
// would. To refresh it, re-run a search and redact again the same way.
//
// Report sections follow lib/riskGrouper.ts's five risk groups, plus the
// supply-chain register.

export type SampleTone = 'clear' | 'finding' | 'info';

export interface SampleItem {
  title: string;
  detail?: string;
  facts: [string, string][];
}

export interface SampleSource {
  name: string;
  result: string;
  tone: SampleTone;
}

export interface SampleSection {
  id: string;
  title: string;
  tone: SampleTone;
  headline: string;
  short: string; // chip text in the homepage preview
  sources: SampleSource[];
  items: SampleItem[];
}

// Rendered with a blur; the text itself is already a placeholder.
export const REDACTED = 'Redacted';

export const SAMPLE_REPORT = {
  entityLabel: 'NSW residential builder (Pty Ltd)',
  searchedOn: 'October 2026',
  sourcesChecked: 16,
  sections: [
    {
      id: 'licensing',
      title: 'Licensing & regulatory standing',
      tone: 'finding',
      headline: 'Current NSW contractor licence, with compliance history recorded against it.',
      short: 'Current · history',
      sources: [
        { name: 'NSW contractor licence register', result: '3 licence records', tone: 'finding' },
        { name: 'Access Canberra builder licences', result: 'No ACT licence', tone: 'info' },
        { name: 'ACT disciplinary register', result: 'None found', tone: 'clear' },
      ],
      items: [
        {
          title: 'Company contractor licence',
          detail: 'Matched to the business by its ABN.',
          facts: [
            ['Status', 'Current'],
            ['Expires', '2027'],
            ['Licence number', REDACTED],
            ['Compliance history', '5 recorded events. See the licence record for details'],
          ],
        },
        {
          title: 'Nominated supervisor’s licence',
          detail: 'The person named as nominated supervisor on the company licence.',
          facts: [
            ['Status', 'Current'],
            ['Name', REDACTED],
            ['Compliance history', 'None recorded'],
          ],
        },
        {
          title: 'Linked company licence',
          detail: 'Another company that lists the same nominated supervisor.',
          facts: [
            ['Status', 'Current'],
            ['Company', REDACTED],
            ['Compliance history', 'None recorded'],
          ],
        },
      ],
    },
    {
      id: 'legal',
      title: 'Legal proceedings & dispute history',
      tone: 'finding',
      headline: '1 published NSW tribunal decision naming the business.',
      short: '1 decision',
      sources: [
        { name: 'NSW courts and tribunals', result: '1 decision', tone: 'finding' },
        { name: 'Federal courts', result: 'None found', tone: 'clear' },
        { name: 'ACT courts and ACAT', result: 'None found', tone: 'clear' },
        { name: 'Fair Work Ombudsman', result: 'None found', tone: 'clear' },
      ],
      items: [
        {
          title: 'NCAT decision (2021)',
          detail: 'Administrative and Equal Opportunity Division. A discrimination complaint against the business; the decision deals with whether the complaint could proceed.',
          facts: [
            ['Parties', REDACTED],
            ['Citation', REDACTED],
          ],
        },
      ],
    },
    {
      id: 'insolvency',
      title: 'Insolvency & financial distress',
      tone: 'clear',
      headline: 'No insolvency or tax-debt notices found.',
      short: 'None found',
      sources: [
        { name: 'ASIC published notices: insolvency', result: 'None since July 2012', tone: 'clear' },
        { name: 'ASIC published notices: ATO tax debt', result: 'None found', tone: 'clear' },
        { name: 'Payment Times Reporting Register', result: 'Not a reporter', tone: 'info' },
      ],
      items: [],
    },
    {
      id: 'corporate',
      title: 'Corporate structure & phoenix risk',
      tone: 'clear',
      headline: 'Long-established company. No disqualified directors or enforceable undertakings.',
      short: 'Clear',
      sources: [
        { name: 'Australian Business Register', result: 'ABN active', tone: 'clear' },
        { name: 'ASIC company register', result: 'Registered', tone: 'clear' },
        { name: 'ASIC disqualified persons', result: '6 directors checked, none found', tone: 'clear' },
        { name: 'ASIC director company history', result: 'No other associations found', tone: 'clear' },
        { name: 'ASIC enforceable undertakings', result: 'None found', tone: 'clear' },
      ],
      items: [
        {
          title: 'Company record',
          facts: [
            ['Company status', 'Registered (since 1989)'],
            ['ABN status', 'Active (since 2000)'],
            ['GST', 'Registered'],
            ['Former names', '2 recorded'],
            ['ABN / ACN', REDACTED],
          ],
        },
      ],
    },
    {
      id: 'supply-chain',
      title: 'Supply-chain statements',
      tone: 'info',
      headline: '6 modern slavery statements lodged, 2019 to 2025.',
      short: '6 statements',
      sources: [{ name: 'Modern Slavery Statements Register', result: '6 statements', tone: 'info' }],
      items: [
        {
          title: 'Joint statements with its corporate group',
          detail: 'Lodged every year from the 2019–20 reporting period to 2024–25.',
          facts: [['Co-reporting entities', REDACTED]],
        },
      ],
    },
  ] as SampleSection[],
};

export const SAMPLE_FINDINGS = SAMPLE_REPORT.sections.filter((s) => s.tone === 'finding').length;
