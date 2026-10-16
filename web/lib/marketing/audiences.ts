// Content for /for/[audience]. Each page: who it's for, when to check, what to
// look for in the report, red flags, and what a report can't tell you.

export interface Audience {
  slug: 'owner-builders' | 'subcontractors' | 'developers';
  nav: string;
  title: string;
  metaTitle: string;
  description: string;
  lead: string;
  whenToCheck: string[];
  lookFor: { risk: string; why: string }[];
  redFlags: string[];
  alsoDo: string[];
}

export const AUDIENCES: Audience[] = [
  {
    slug: 'owner-builders',
    nav: 'Owner-builders and homeowners',
    title: 'Check your builder before you hand over a deposit.',
    metaTitle: 'Builder checks for homeowners and owner-builders (NSW & ACT)',
    description:
      'A free builder check for homeowners and owner-builders in NSW and the ACT: licence status, insolvency notices and court history in one report, before you sign or pay a deposit.',
    lead:
      'Building or renovating is usually the biggest payment you’ll ever make to a business you’ve just met. A few minutes on the public record first can save a lot of grief.',
    whenToCheck: [
      'Before you sign the building contract.',
      'Before you pay the deposit.',
      'Before each large progress payment on a long build, in case something has changed.',
      'Before hiring any trade directly as an owner-builder.',
    ],
    lookFor: [
      { risk: 'Licence status', why: 'The licence should be current, cover the type of work, and be held by the same business named on your contract.' },
      { risk: 'Insolvency notices', why: 'A liquidation, administration or winding-up application is a reason to stop and get advice before paying anything.' },
      { risk: 'Court and tribunal decisions', why: 'Home building disputes in NCAT or ACAT show how past jobs went wrong, and how the builder responded.' },
      { risk: 'Disciplinary action', why: 'Conditions, suspensions and penalty notices recorded against the licence.' },
      { risk: 'Directors’ other companies', why: 'Directors linked to a string of failed companies is a classic phoenix-company warning sign.' },
    ],
    redFlags: [
      'The licence is held by a different business, or a different person, from the one on your contract.',
      'A deposit bigger than your state allows, or pressure to pay before the contract and insurance are in place.',
      'A company registered only recently, run by directors whose previous companies went into liquidation.',
      'Requests to pay in cash, into a personal account, or to a different business name.',
    ],
    alsoDo: [
      'Ask for the home building insurance certificate before paying a deposit, where your state requires it.',
      'Speak to two or three recent clients and, if you can, see their finished work.',
      'Have the contract reviewed before you sign it.',
    ],
  },
  {
    slug: 'subcontractors',
    nav: 'Subcontractors',
    title: 'Check the head contractor before you start the job.',
    metaTitle: 'Check a head contractor before you subcontract (NSW & ACT)',
    description:
      'Free head contractor checks for subcontractors in NSW and the ACT: insolvency notices, ATO tax-debt notices, payment history and court disputes in one report.',
    lead:
      'When a builder fails, subcontractors are usually last in line. The warning signs often show up on the public record months earlier.',
    whenToCheck: [
      'Before you quote or sign a subcontract with a builder you haven’t worked for.',
      'When payments start arriving late or short.',
      'Before you order materials for a big stage of work.',
    ],
    lookFor: [
      { risk: 'Insolvency notices', why: 'Winding-up applications and administrations are published by ASIC. Don’t extend more credit until you understand them.' },
      { risk: 'ATO tax-debt notices', why: 'Disclosed tax debts can signal cash-flow stress well before a collapse.' },
      { risk: 'Payment times', why: 'Large businesses must report how long they take to pay small suppliers.' },
      { risk: 'Court and tribunal decisions', why: 'Security of payment and contract disputes with other trades.' },
      { risk: 'Fair Work enforcement', why: 'Underpayment and enforcement outcomes against the business.' },
    ],
    redFlags: [
      'A recent winding-up application by the ATO or another creditor.',
      'Payment claims answered late, or without a payment schedule.',
      'A history of adjudication or court disputes with other subcontractors.',
      'Requests to keep working while overdue claims stay unpaid.',
    ],
    alsoDo: [
      'Know your rights under your state’s security of payment law and the deadlines that apply.',
      'Keep every payment claim, schedule and variation in writing.',
      'Ask how your retention will be held, and when it will be released.',
    ],
  },
  {
    slug: 'developers',
    nav: 'Developers',
    title: 'Vet every builder at tender with the same report.',
    metaTitle: 'Builder due diligence for developers (NSW & ACT)',
    description:
      'Consistent builder due diligence for developers in NSW and the ACT: licence, ASIC, insolvency, enforcement and court records for every tenderer, in one free report each.',
    lead:
      'One builder’s collapse can stall a whole project. Running the same check on every tenderer gives you a like-for-like view before you award the contract.',
    whenToCheck: [
      'When shortlisting tenderers.',
      'Before awarding the head contract.',
      'Periodically during the build, especially before large progress payments.',
    ],
    lookFor: [
      { risk: 'Licence and discipline', why: 'Current licence for the class of work, and any conditions or disciplinary action.' },
      { risk: 'Financial distress', why: 'Insolvency and tax-debt notices, and payment times where the builder is a large reporter.' },
      { risk: 'Regulator enforcement', why: 'ASIC disqualified directors, enforceable undertakings and Fair Work outcomes.' },
      { risk: 'Dispute history', why: 'Published court and tribunal decisions, including disputes with subcontractors.' },
      { risk: 'Corporate structure', why: 'Directors’ links to other companies, including failed ones.' },
    ],
    redFlags: [
      'A tender price well below the field from a builder showing financial distress signals.',
      'Directors with a history of failed companies.',
      'Repeated payment disputes with subcontractors, which often precede site stoppages.',
    ],
    alsoDo: [
      'Ask for financial statements and referees for projects of a similar size.',
      'Confirm the builder’s insurances and any security they will provide.',
      'Re-run the check before large payments on long builds.',
    ],
  },
];

export function getAudience(slug: string) {
  return AUDIENCES.find((a) => a.slug === slug);
}
