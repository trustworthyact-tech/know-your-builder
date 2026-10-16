import type { Metadata } from 'next';
import { Article } from '@/components/marketing/Article';
import { Callout } from '@/components/marketing/ui';
import { STATES } from '@/lib/marketing/states';

const path = '/resources/guides/home-building-insurance-by-state';
const title = 'Home building insurance by state';
const lead =
  'Most states require builders to insure residential work above a set value, so you’re protected if the builder can’t finish the job or fix defects. Here’s what applies where you’re building.';

export const metadata: Metadata = {
  title: 'Home building insurance by state: thresholds and deposits',
  description:
    'When a builder must take out home building or home warranty insurance in each Australian state and territory, and what to ask for before you pay a deposit.',
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
        { name: 'icare: What is HBCF? (NSW)', url: 'https://www.icare.nsw.gov.au/builders-and-homeowners/homeowners/what-is-icare-hbcf' },
        { name: 'ACT Planning: Responsibilities', url: 'https://www.planning.act.gov.au/professionals/regulation-and-responsibilities/responsibilities' },
        { name: 'QBCC: What work requires insurance', url: 'https://www.qbcc.qld.gov.au/running-your-business/home-warranty-insurance-obligations/what-work-requires-insurance' },
        { name: 'Building and Plumbing Commission: Insurance for domestic building work (VIC)', url: 'https://www.bpc.vic.gov.au/home-owners/insurance-for-domestic-building-work' },
        { name: 'Building and Energy: Building or renovating your home (WA)', url: 'https://www.wa.gov.au/organisation/building-and-energy/building-or-renovating-your-home' },
      ]}
    >
      <div className="overflow-x-auto">
        <table>
          <thead>
            <tr>
              <th>State</th>
              <th>What applies</th>
            </tr>
          </thead>
          <tbody>
            {STATES.map((s) => (
              <tr key={s.slug}>
                <td>
                  <a href={`/check-builder-licence/${s.slug}`}>{s.code}</a>
                </td>
                <td>
                  {s.insurance}
                  {s.deposit ? ` ${s.deposit}` : ''}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <Callout title="Ask for the certificate before you pay">
        In states that require insurance, ask for the certificate (or notice of cover) before you hand over a
        deposit, and check it names your property and your builder. In NSW it is illegal for a builder to ask
        for a deposit before giving you one.
      </Callout>

      <h2>What this insurance does and doesn’t do</h2>
      <p>
        These schemes are generally a last resort. They pay out when the builder can’t complete the work or
        fix defects because they’ve become insolvent, died or disappeared, and in some states when they’ve
        lost their licence. They aren’t a substitute for checking the builder before you sign.
      </p>
      <p>
        <a href="/check-builder-licence">Check your builder’s licence</a>, or in NSW and the ACT, run a{' '}
        <a href="/check">free Know Your Builder report</a>.
      </p>
    </Article>
  );
}
