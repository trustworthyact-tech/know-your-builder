import type { Metadata } from 'next';
import { Article } from '@/components/marketing/Article';
import { Callout } from '@/components/marketing/ui';

const path = '/resources/guides/builder-gone-into-liquidation-nsw';
const title = 'Your builder has gone into liquidation: what to do in NSW';
const lead =
  'Finding out your builder has collapsed is stressful. These are the first steps for homeowners and subcontractors in NSW, and how the Home Building Compensation Fund can help.';

export const metadata: Metadata = {
  title: 'Builder gone into liquidation in NSW? What to do next',
  description:
    'First steps when a NSW builder goes into liquidation: lodge a notification of loss with icare HBCF, what the fund covers, time limits, and what subcontractors should do.',
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
        { name: 'icare: When something goes wrong', url: 'https://www.icare.nsw.gov.au/builders-and-homeowners/homeowners/hbcf-when-something-goes-wrong-what-do-i-do' },
        { name: 'icare: What is HBCF?', url: 'https://www.icare.nsw.gov.au/builders-and-homeowners/homeowners/what-is-icare-hbcf' },
        { name: 'NSW Government: Protecting yourself in case of builder insolvency', url: 'https://www.nsw.gov.au/housing-and-construction/building-or-renovating-a-home/protecting-yourself-case-of-builder-insolvency' },
        { name: 'ASIC published notices', url: 'https://publishednotices.asic.gov.au/' },
      ]}
    >
      <h2>First, confirm what has happened</h2>
      <p>
        Search the builder’s name on <a href="https://publishednotices.asic.gov.au/">ASIC’s published notices</a>{' '}
        for a liquidation, administration or winding-up notice. Keep any letter or email you receive from the
        builder or an appointed liquidator. <a href="/check">Know Your Builder</a> shows these notices
        alongside the builder’s licence and court records.
      </p>

      <h2>If you’re a homeowner</h2>
      <p>icare, which runs the Home Building Compensation Fund (HBCF), recommends these steps:</p>
      <ol>
        <li>Talk to the builder, if you still can.</li>
        <li>Put everything in writing and keep copies.</li>
        <li>Contact Building Commission NSW on 13 27 00.</li>
        <li>
          Lodge a Notification of Loss with icare as soon as possible. It helps protect your right to make a
          claim, so lodge one even if you’re not sure you’ll need it.
        </li>
      </ol>

      <h3>What HBCF can cover</h3>
      <p>
        HBCF is a last-resort scheme. It may cover loss from incomplete or defective residential building work
        when the builder becomes insolvent (for example, bankrupt or in liquidation), dies, disappears, or has
        their licence suspended for not paying an NCAT or court order. The cover stays with the property.
      </p>
      <div className="overflow-x-auto">
        <table>
          <thead>
            <tr>
              <th>Problem</th>
              <th>Cover period</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td>Incomplete or non-started work</td>
              <td>Up to 12 months from when work stopped or failed to start</td>
            </tr>
            <tr>
              <td>Major defects</td>
              <td>6 years</td>
            </tr>
            <tr>
              <td>Other defects</td>
              <td>2 years</td>
            </tr>
          </tbody>
        </table>
      </div>
      <p>
        You can check whether your job is covered using the NSW Government’s{' '}
        <a href="https://verify.licence.nsw.gov.au/home/HBCF">HBC certificate check</a>.
      </p>

      <Callout title="Money you may not get back">
        Payments above the 10% maximum deposit, progress payments the contract didn’t authorise, and upfront
        fees for plans may not be recoverable. Don’t make further payments until you’ve spoken to Building
        Commission NSW and icare.
      </Callout>

      <h2>If you’re a subcontractor</h2>
      <ul>
        <li>Stop work and stop ordering materials for the job until you know who will pay you.</li>
        <li>
          Gather your contract, payment claims, payment schedules, invoices and any retention records. The
          liquidator will contact creditors, and you can lodge a proof of debt for what you’re owed.
        </li>
        <li>
          If you were working for a head contractor who is still trading, your rights under the{' '}
          <a href="/resources/guides/security-of-payment-act-nsw">Security of Payment Act</a> still apply to
          them.
        </li>
        <li>Get advice from a construction lawyer or your industry association early.</li>
      </ul>

      <h2>Before your next job</h2>
      <p>
        Most builder collapses leave a trail first: tax-debt notices, winding-up applications, payment disputes,
        or directors with failed companies behind them. <a href="/check">Check the next builder</a> before you
        sign.
      </p>
    </Article>
  );
}
