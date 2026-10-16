import type { Metadata } from 'next';
import { PageHeader, Prose } from '@/components/marketing/ui';

// Migrated verbatim from the WordPress site's /legal/ page (published
// 2026-09-25). Wording is the business owner's — don't edit it here without
// their sign-off. Known issues flagged for their review: the contact email is a
// Gmail address, and Addendum A lists "ASIC Data API" for director history,
// which isn't connected yet (CLAUDE.md, Phase 7c).

export const metadata: Metadata = {
  title: 'Terms & Conditions',
  description: 'Terms of use for trustworthypayments.com and Know Your Builder, including the data sources the platform aggregates.',
  alternates: { canonical: '/terms' },
};

const SOURCES: { group: string; rows: [string, string][] }[] = [
  {
    group: 'Commonwealth',
    rows: [
      ['ABN/company lookup', 'Australian Business Register'],
      ['Company search', 'ASIC Connect'],
      ['Disqualified persons', 'ASIC Disqualified Persons Register'],
      ['Insolvency notices', 'ASIC Published Notices'],
      ['ATO tax debt disclosures', 'ASIC Published Notices register, (s260-45 notices)'],
      ['Federal court judgments', 'Federal Court / High Court search'],
      ['Payment times', 'Payment Times Reporting Register'],
      ['Modern slavery statements', 'modernslaveryregister.gov.au'],
      ['Fair Work enforcement', 'Fair Work Ombudsman newsroom'],
      ['Director/company history (phoenix detection)', 'ASIC Connect + ASIC Data API'],
      ['Court enforceable undertakings', 'ASIC'],
    ],
  },
  {
    group: 'NSW',
    rows: [
      ['NSW court/tribunal judgments', 'NSW Caselaw'],
      ['Contractor licences', 'Verify NSW'],
    ],
  },
  {
    group: 'ACT',
    rows: [
      ['ACT court/tribunal judgments', 'ACT Courts, ACAT'],
      ['Builder licences', 'Access Canberra'],
      ['Disciplinary registers', 'Access Canberra'],
    ],
  },
];

export default function TermsPage() {
  return (
    <>
      <PageHeader
        title="Terms & Conditions"
        crumbs={[
          { href: '/', label: 'Home' },
          { href: '/terms', label: 'Terms & Conditions' },
        ]}
      />
      <div className="mx-auto max-w-6xl px-4 py-12 sm:px-6">
        <Prose>
          <h2>1. Acceptance of Terms</h2>
          <p>
            By accessing, searching, or using the Site, you (“User”, “you”) agree to be bound by these Terms of
            Use (“Terms”). If you do not agree to all of these Terms, you must immediately cease using the Site.
          </p>

          <h2>2. Nature of the Service</h2>
          <ol>
            <li>
              <strong>Aggregated Information Only:</strong> The Platform acts solely as a central repository and
              search tool that aggregates publicly available data, court lists, licensing registries, corporate
              records, and statutory disclosures regarding commercial and residential builders, contractors, and
              corporate entities (“Search Data”).
            </li>
            <li>
              <strong>Not Financial or Legal Advice:</strong> The content on the Site is provided for general
              informational and preliminary research purposes only. It does not constitute legal, financial,
              accounting, risk-management, or professional advice.
            </li>
            <li>
              <strong>Independent Verification Required:</strong> You acknowledge and agree that Search Data may
              be incomplete, out of date, or contain errors. You must independently verify any court records,
              financial standings, or licensing statuses directly with the relevant statutory authority before
              taking or refraining from any commercial, legal, or financial action.
            </li>
          </ol>

          <h2>3. No Guarantee, Warranty, or Accuracy</h2>
          <ol>
            <li>
              <strong>“As-Is” Provision:</strong> To the maximum extent permitted by law, the Platform and Search
              Data are provided on an “as is” and “as available” basis without warranties of any kind, whether
              express or implied.
            </li>
            <li>
              <strong>Third-Party Data Sources:</strong> We ingest data from third-party public databases and
              external registers. Trustworthy does not create, edit, or control the primary source documents and
              cannot guarantee the correctness, accuracy, completeness, currency, or uninterrupted availability of
              the Search Data.
            </li>
            <li>
              <strong>No Representation on Solvency or Standing:</strong> A search result indicating a lack of
              court records or insolvency notices does not guarantee that a builder is solvent, compliant, or
              financially stable. Conversely, the presence of historical records does not imply current
              wrongdoing or active insolvency.
            </li>
            <li>
              <strong>Not a Credit Report or Creditworthiness Assessment:</strong>
              <ul>
                <li>
                  <strong>No Credit Reporting Agency Status:</strong> Trustworthy is not a consumer credit
                  reporting agency or commercial credit rating agency, and the Platform does not issue credit
                  scores, credit ratings, or statutory credit reports.
                </li>
                <li>
                  <strong>No Assessment of Creditworthiness:</strong> The outputs, aggregated summaries, or
                  historical indicators provided on this Platform do not constitute an evaluation, assessment, or
                  opinion of any party’s creditworthiness, credit standing, credit capacity, or eligibility for
                  credit.
                </li>
                <li>
                  <strong>Non-Reliance for Credit Decisions:</strong> Search Data must not be used as the sole or
                  primary basis for deciding whether to extend credit, enter into commercial trade terms, or
                  supply goods and services on credit.
                </li>
              </ul>
            </li>
          </ol>

          <h2>4. Limitation of Liability</h2>
          <ol>
            <li>
              <strong>Exclusion of Consequential Loss:</strong> To the fullest extent permitted by law,
              Trustworthy, its directors, employees, and agents shall not be liable to you or any third party for
              any direct, indirect, incidental, special, or consequential loss or damage (including loss of
              profits, commercial loss, project delays, or legal expenses) arising out of or in connection with:
              <ul>
                <li>Your reliance on any Search Data or output generated by the Platform.</li>
                <li>Any errors, omissions, or inaccuracies in the aggregated data.</li>
                <li>Unavailability or disruption of the Site.</li>
              </ul>
            </li>
            <li>
              <strong>Statutory Guarantees:</strong> Where legislation implies any consumer guarantee or condition
              that cannot be excluded, our total aggregate liability for breach of such condition is limited (at
              our election) to the re-supply of the services or the cost of re-supplying the services.
            </li>
          </ol>

          <h2>5. Hold Harmless &amp; Defamation Disclaimer</h2>
          <ol>
            <li>
              <strong>No Defamatory Intent:</strong> Search Data is sourced verbatim or via automated indexing from
              publicly available records and public registers. The publication of public record summaries does
              not constitute an assertion, opinion, or endorsement by Trustworthy regarding the character,
              integrity, or commercial solvency of any individual or entity.
            </li>
            <li>
              <strong>Indemnity:</strong> You agree to defend, indemnify, and hold harmless Trustworthy against any
              claims, liabilities, costs, or damages (including legal fees on a full indemnity basis) arising from
              your misuse of Search Data, breach of these Terms, or reliance on the Platform to make commercial
              decisions regarding third parties.
            </li>
          </ol>

          <h2>6. User Obligations &amp; Prohibited Conduct</h2>
          <p>
            When using the Site, you warrant and agree that you will <strong>not</strong>:
          </p>
          <ul>
            <li>
              Use automated systems, bots, scrapers, or spidering tools to extract, mirror, or harvest data from
              the Site without explicit prior written authorization.
            </li>
            <li>Use the Platform to harass, defame, intimidate, or unlawfully stalk any individual or contractor.</li>
            <li>
              Circumvent security measures, attempt unauthorised access to backend servers, or cause unreasonable
              network load.
            </li>
            <li>
              Pass off, re-sell, or commercialise Search Data as your own proprietary credit reporting service
              without a formal reseller agreement.
            </li>
          </ul>

          <h2>7. Intellectual Property</h2>
          <p>
            All rights, title, and interest in and to the Platform (excluding primary raw public register data),
            including overall UX, brand elements, code, databases, and search aggregation workflows, remain the
            exclusive property of Trustworthy Payments Pty Ltd.
          </p>

          <h2>8. Privacy</h2>
          <p>
            Your use of the Platform is subject to our <a href="/privacy">Privacy Policy</a>, which explains how
            we collect, handle, and protect personal information in accordance with applicable privacy laws.
          </p>

          <h2>9. Governing Law</h2>
          <p>
            These Terms are governed by and construed in accordance with the laws of Australian Capital
            Territory, Australia. You irrevocably submit to the non-exclusive jurisdiction of the courts of that
            venue.
          </p>

          <h2>10. Contact Us</h2>
          <p>If you notice an error in public record indexing or wish to report an issue, please contact us at:</p>
          <p>Email: trustworthy.act@gmail.com</p>

          <h2 id="data-sources">Addendum A: Disclosed Data Sources</h2>
          <p>
            The Platform aggregates public and statutory information from various third-party databases, public
            registries, and government repositories. The list below outlines the primary categories and sources
            of data ingested by the Platform:
          </p>
          {SOURCES.map((s) => (
            <div key={s.group} className="overflow-x-auto">
              <h3>{s.group}</h3>
              <table>
                <thead>
                  <tr>
                    <th>Name</th>
                    <th>Source</th>
                  </tr>
                </thead>
                <tbody>
                  {s.rows.map(([name, source]) => (
                    <tr key={name}>
                      <td>{name}</td>
                      <td>{source}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ))}

          <h2>Important Source Disclaimer</h2>
          <ol>
            <li>
              <strong>Third-Party Ownership:</strong> All trademarks, register names, and dataset names belong to
              their respective statutory owners or government departments. Trustworthy is not affiliated with,
              endorsed by, or sponsored by any government regulator or court registry.
            </li>
            <li>
              <strong>Lag &amp; Refresh Rates:</strong> Data ingested from the above sources is refreshed
              periodically and may not reflect real-time updates. Recent filings, license reinstatements, or
              court dismissals may experience a delay before appearing on the Platform.
            </li>
          </ol>
        </Prose>
      </div>
    </>
  );
}
