import type { WaitlistProduct } from '@/lib/marketing/waitlist';

// /check-builder-licence/[state] content. Every fact here was checked against
// the regulator's own site on 2026-10-16 (see CONTENT_REVIEWED in site.ts).
// Where a fact couldn't be confirmed from an official page (SA/TAS/NT insurance
// thresholds), the page tells people to confirm with the regulator instead of
// quoting a number. Re-check before changing any figure.
//
// `covered` must match the KYB launch scope (NSW + ACT — CLAUDE.md "Launch
// scope"). Non-covered states get a waitlist, never the search box.

export interface StateGuide {
  slug: 'nsw' | 'act' | 'qld' | 'vic' | 'wa' | 'sa' | 'tas' | 'nt';
  code: string;
  name: string;
  covered: boolean;
  waitlist?: WaitlistProduct;
  regulator: string;
  registerName: string;
  registerUrl: string;
  extraRegister?: { name: string; url: string; what: string };
  howTo: string[];
  insurance: string;
  deposit?: string;
  kybChecks?: string[];
  faqs: { q: string; a: string }[];
}

export const STATES: StateGuide[] = [
  {
    slug: 'nsw',
    code: 'NSW',
    name: 'New South Wales',
    covered: true,
    regulator: 'Building Commission NSW',
    registerName: 'Verify licence (NSW Government)',
    registerUrl: 'https://verify.licence.nsw.gov.au/home/Trades',
    howTo: [
      'Open the NSW Government’s Verify licence service and choose home building and trades.',
      'Search by the builder’s name, business name or licence number.',
      'Check the licence is current, covers the type of work you need, and is held by the same person or company named on your contract.',
      'Open the licence record to see any conditions or compliance history recorded against it.',
    ],
    insurance:
      'Home Building Compensation Fund (HBCF) cover is required for most residential building work over $20,000. The builder must give you the HBCF certificate before asking for a deposit or any other payment under the contract.',
    deposit: 'The maximum deposit you can be asked to pay is 10%.',
    kybChecks: [
      'Contractor licence status and class on the NSW register, plus any compliance history recorded against it',
      'NSW court and tribunal decisions, including NCAT home building disputes',
      'ASIC company status, insolvency notices, disqualified directors and enforceable undertakings',
      'ATO tax-debt notices, payment times and Fair Work enforcement outcomes',
    ],
    faqs: [
      {
        q: 'Who licenses builders in NSW?',
        a: 'Building Commission NSW. Licences are published on the NSW Government’s Verify licence service, where anyone can search by name or licence number.',
      },
      {
        q: 'Do I need home building insurance for my renovation?',
        a: 'For most residential building work over $20,000, yes. The builder must take out HBCF cover and give you the certificate before asking for a deposit.',
      },
      {
        q: 'How much deposit can a NSW builder ask for?',
        a: 'Up to 10% for residential building work.',
      },
    ],
  },
  {
    slug: 'act',
    code: 'ACT',
    name: 'Australian Capital Territory',
    covered: true,
    regulator: 'Access Canberra',
    registerName: 'Construction Occupations Public Register: licensed builders',
    registerUrl: 'https://services.accesscanberra.act.gov.au/s/public-registers/construction-licences?registerid=licensed-builders',
    extraRegister: {
      name: 'Construction Occupations disciplinary register',
      url: 'https://services.accesscanberra.act.gov.au/s/public-registers/construction-licences?registerid=disciplinary-register',
      what: 'Lists suspensions, cancellations and other disciplinary action from the last 10 years.',
    },
    howTo: [
      'Open Access Canberra’s public register of licensed builders.',
      'Search by the builder’s name or licence number.',
      'Check the licence is current, the class covers your work, and the licensee matches the name on your contract.',
      'Then search the disciplinary register for the same name.',
    ],
    insurance:
      'Builders need residential building insurance (also called housing indemnity insurance) or a fidelity certificate for certain residential work, including alterations and additions valued at $12,000 or more.',
    kybChecks: [
      'ACT builder licence status on the Access Canberra register',
      'The ACT register of disciplinary actions',
      'ACT court decisions and ACAT tribunal decisions',
      'ASIC company status, insolvency notices, disqualified directors and enforceable undertakings',
    ],
    faqs: [
      {
        q: 'Who licenses builders in the ACT?',
        a: 'Access Canberra. It publishes the register of licensed builders and a separate disciplinary register.',
      },
      {
        q: 'Does my ACT builder need insurance?',
        a: 'For certain residential work, including alterations and additions valued at $12,000 or more, the builder needs residential building insurance or a fidelity certificate.',
      },
    ],
  },
  {
    slug: 'qld',
    code: 'QLD',
    name: 'Queensland',
    covered: false,
    waitlist: 'kyb_qld',
    regulator: 'Queensland Building and Construction Commission (QBCC)',
    registerName: 'QBCC licensee register',
    registerUrl: 'https://my.qbcc.qld.gov.au/myQBCC/s/qbcc-licensee-register',
    howTo: [
      'Open the QBCC licensee register.',
      'Search by the contractor’s name or licence number.',
      'Check the licence class covers the work and the licensee matches the name on your quote or contract.',
    ],
    insurance:
      'Residential construction work valued over $3,300 must be covered by the Queensland Home Warranty Scheme. Ask the contractor for confirmation that the work has been insured.',
    faqs: [
      {
        q: 'Who licenses builders in Queensland?',
        a: 'The Queensland Building and Construction Commission (QBCC). Its licensee register is free to search.',
      },
    ],
  },
  {
    slug: 'vic',
    code: 'VIC',
    name: 'Victoria',
    covered: false,
    waitlist: 'kyb_vic',
    regulator: 'Building and Plumbing Commission (BPC)',
    registerName: 'Find and check a practitioner',
    registerUrl: 'https://www.bpc.vic.gov.au/find-and-check-a-practitioner',
    howTo: [
      'Open the Building and Plumbing Commission’s “Find and check a practitioner” search.',
      'Search by the builder’s name or registration number.',
      'Check the registration is current, covers the work, and matches the name on your contract.',
      'Also check the BPC’s compliance and enforcement register for the same name.',
    ],
    insurance:
      'For contracts signed from 1 July 2026, eligible domestic building work over $20,000 must be covered by Home Warranty. The builder pays the premium and you receive a Notice of Cover.',
    faqs: [
      {
        q: 'Who registers builders in Victoria?',
        a: 'The Building and Plumbing Commission (BPC), the trading name of the Victorian Building Authority since its rebrand.',
      },
    ],
  },
  {
    slug: 'wa',
    code: 'WA',
    name: 'Western Australia',
    covered: false,
    waitlist: 'kyb_wa',
    regulator: 'Building and Energy (Department of Local Government, Industry Regulation and Safety)',
    registerName: 'WA Online Licence Search',
    registerUrl: 'https://ols.demirs.wa.gov.au/search',
    howTo: [
      'Open the WA Online Licence Search.',
      'Search for the builder by name or registration number.',
      'Check the registration is current and matches the name on your contract.',
    ],
    insurance:
      'Home indemnity insurance is required for building work that needs a building permit and is valued at more than $20,000.',
    deposit: 'The maximum deposit is 6.5% for contracts between $7,500 and $500,000.',
    faqs: [
      {
        q: 'How much deposit can a WA builder ask for?',
        a: 'Up to 6.5% for contracts between $7,500 and $500,000.',
      },
    ],
  },
  {
    slug: 'sa',
    code: 'SA',
    name: 'South Australia',
    covered: false,
    waitlist: 'kyb_sa',
    regulator: 'Consumer and Business Services (CBS)',
    registerName: 'Find a licence holder',
    registerUrl: 'https://www.cbs.sa.gov.au/find-a-licence-holder',
    howTo: [
      'Open Consumer and Business Services’ “Find a licence holder” search.',
      'Search for the builder’s name or licence number.',
      'Check the licence is current, the conditions cover your work, and the name matches your contract.',
    ],
    insurance:
      'Ask the builder whether building indemnity insurance applies to your job, and confirm the rules with Consumer and Business Services before paying a deposit.',
    faqs: [
      {
        q: 'Who licenses builders in South Australia?',
        a: 'Consumer and Business Services (CBS). Its “Find a licence holder” search is free.',
      },
    ],
  },
  {
    slug: 'tas',
    code: 'TAS',
    name: 'Tasmania',
    covered: false,
    waitlist: 'kyb_tas',
    regulator: 'Consumer, Building and Occupational Services (CBOS)',
    registerName: 'Search licensed occupations',
    registerUrl: 'https://www.cbos.tas.gov.au/',
    howTo: [
      'Go to the CBOS website and open “Search licensed occupations” under Licensing and Registration.',
      'Search for the builder by name or licence number.',
      'Check the licence is current and covers the work you need.',
    ],
    insurance:
      'Ask the builder what warranty or insurance covers your job, and confirm the requirements with CBOS before you sign.',
    faqs: [
      {
        q: 'Who licenses builders in Tasmania?',
        a: 'Consumer, Building and Occupational Services (CBOS).',
      },
    ],
  },
  {
    slug: 'nt',
    code: 'NT',
    name: 'Northern Territory',
    covered: false,
    waitlist: 'kyb_nt',
    regulator: 'Building Practitioners Board',
    registerName: 'Register of Building Practitioners',
    registerUrl: 'http://www.ntlis.nt.gov.au/building-practitioners/',
    howTo: [
      'Open the NT Register of Building Practitioners.',
      'Search for the builder by name or registration number.',
      'Check the registration is current and the category covers your work.',
    ],
    insurance:
      'Ask the builder what residential building cover applies to your job, and confirm the requirements with the Building Practitioners Board before you sign.',
    faqs: [
      {
        q: 'Who registers builders in the Northern Territory?',
        a: 'The Building Practitioners Board, which publishes the Register of Building Practitioners.',
      },
    ],
  },
];

export function getState(slug: string) {
  return STATES.find((s) => s.slug === slug);
}

// National registers anyone can search by hand — shown on every state page,
// and the main manual fallback for states KYB doesn't cover yet.
export const NATIONAL_CHECKS = [
  { name: 'ABN Lookup', url: 'https://abr.business.gov.au/', what: 'Confirms the ABN is active and who it belongs to.' },
  { name: 'ASIC published notices', url: 'https://publishednotices.asic.gov.au/', what: 'Liquidation, administration and winding-up notices.' },
  {
    name: 'ASIC banned and disqualified register',
    url: 'https://connectonline.asic.gov.au/RegistrySearch/faces/landing/SearchRegisters.jspx',
    what: 'People banned from managing companies.',
  },
];
