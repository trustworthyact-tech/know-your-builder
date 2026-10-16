import type { Metadata } from 'next';
import { Article } from '@/components/marketing/Article';
import { Callout } from '@/components/marketing/ui';

const path = '/resources/guides/security-of-payment-act-nsw';
const title = 'The NSW Security of Payment Act, explained';
const lead =
  'If you do construction work in NSW, the Building and Construction Industry Security of Payment Act 1999 gives you a legal right to progress payments, and strict deadlines for the people who owe you.';

export const metadata: Metadata = {
  title: 'Security of Payment Act NSW: payment claims, schedules and deadlines',
  description:
    'A plain-English guide to the NSW Security of Payment Act: how to make a payment claim, when a payment schedule is due, and the maximum payment terms for head contractors and subcontractors.',
  alternates: { canonical: path },
};

export default function Page() {
  return (
    <Article
      path={path}
      title={title}
      lead={lead}
      section={{ href: path, label: 'Guide' }}
      published="2026-10-16"
      sources={[
        { name: 'Building Commission NSW: Security of payment', url: 'https://www.nsw.gov.au/housing-and-construction/compliance-and-regulation/security-of-payment/about' },
        { name: 'Building Commission NSW: Changes to security of payment laws', url: 'https://www.nsw.gov.au/housing-and-construction/compliance-and-regulation/security-of-payment/changes-to-laws' },
        { name: 'Building Commission NSW: Making a payment claim', url: 'https://www.nsw.gov.au/housing-and-construction/compliance-and-regulation/security-of-payment/making-a-payment-claim' },
      ]}
    >
      <h2>Who the Act protects</h2>
      <p>
        Anyone who carries out construction work, or supplies goods and services for it, under a contract in
        NSW. That includes head contractors claiming from a developer and subcontractors claiming from a
        head contractor. Since 1 March 2021 it also covers contracts with homeowners who live in the
        property being built.
      </p>

      <h2>Making a payment claim</h2>
      <ul>
        <li>You can make a progress payment claim once a month, unless your contract allows more often.</li>
        <li>Claims can be served from the last day of each month.</li>
        <li>
          Building Commission NSW advises that payment claims for contracts entered into from 21 October 2019
          should state that they are made under the <em>Building and Construction Industry Security of
          Payment Act 1999</em>. Including that statement on every claim is the safe approach.
        </li>
        <li>Identify the work the claim covers and the amount you’re claiming.</li>
      </ul>

      <h2>The deadlines</h2>
      <div className="overflow-x-auto">
        <table>
          <thead>
            <tr>
              <th>Step</th>
              <th>Deadline</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td>Payment schedule (the respondent’s reply to your claim)</td>
              <td>Within 10 business days of receiving the claim</td>
            </tr>
            <tr>
              <td>Payment from a principal to a head contractor</td>
              <td>No later than 15 business days after the claim</td>
            </tr>
            <tr>
              <td>Payment from a head contractor to a subcontractor</td>
              <td>No later than 20 business days after the claim</td>
            </tr>
          </tbody>
        </table>
      </div>
      <p>
        A contract can set earlier payment dates, but not later ones. Different rules apply to homeowner
        contracts: check the Building Commission NSW pages linked below.
      </p>

      <Callout title="If no payment schedule arrives">
        A respondent who doesn’t reply with a payment schedule on time, and doesn’t pay, can become liable for
        the full amount claimed. You may also be able to apply for adjudication, a fast process for deciding
        payment disputes. Get advice early: the steps after a missed deadline are time-limited too.
      </Callout>

      <h2>Check who you’re working for</h2>
      <p>
        The Act helps you get paid, but it can’t create money that isn’t there. Before you take on work,{' '}
        <a href="/for/subcontractors">check the head contractor</a> for insolvency notices, tax-debt notices
        and payment disputes.
      </p>
    </Article>
  );
}
