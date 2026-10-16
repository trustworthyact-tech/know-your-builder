import type { Metadata } from 'next';
import { PageHeader, Prose, Callout } from '@/components/marketing/ui';

// DRAFT (2026-10-16): under review by the business owner and a lawyer. Before
// launch: fill every TBC value, remove the draft notice and the noindex below.
// Source of truth for wording: the "Trustworthy Payments Privacy Policy (Draft)" doc.
const TBC = (label: string) => (
  <span className="rounded bg-warning-bg px-1 font-semibold text-[#7A3306]">[{label} — to be confirmed]</span>
);

export const metadata: Metadata = {
  title: 'Privacy policy',
  description: 'How Trustworthy Payments collects, uses and protects personal information, including information about people named in Know Your Builder reports.',
  alternates: { canonical: '/privacy' },
  robots: { index: false, follow: true },
};

export default function PrivacyPage() {
  return (
    <>
      <PageHeader
        title="Privacy policy"
        crumbs={[
          { href: '/', label: 'Home' },
          { href: '/privacy', label: 'Privacy policy' },
        ]}
      />
      <div className="mx-auto max-w-6xl px-4 py-12 sm:px-6">
        <Prose>
          <Callout title="Draft">
            This policy is being finalised and may change before it takes effect.
          </Callout>

          <h2>1. About this policy</h2>
          <p>
            This policy explains how Trustworthy Payments Pty Ltd (ABN {TBC('ABN')}) (“we”, “us”) collects,
            uses, discloses and protects personal information. It covers trustworthypayments.com, the Know
            Your Builder service, and our FundSight and Digital Retention Trust waitlists.
          </p>
          <p>
            We handle personal information in line with the <em>Privacy Act 1988</em> (Cth) and the
            Australian Privacy Principles (APPs).
          </p>

          <h2>2. Information we collect</h2>
          <div className="overflow-x-auto">
            <table>
              <thead>
                <tr>
                  <th>Category</th>
                  <th>What it includes</th>
                  <th>When we collect it</th>
                </tr>
              </thead>
              <tbody>
                <tr>
                  <td>Contact details</td>
                  <td>Name, email address</td>
                  <td>When you request a report, create an account, join a waitlist or contact us</td>
                </tr>
                <tr>
                  <td>Account details</td>
                  <td>Email, name, hashed password, or your Google account name, email and the sign-in tokens Google issues if you sign in with Google</td>
                  <td>When you register or sign in</td>
                </tr>
                <tr>
                  <td>Your role and project</td>
                  <td>Whether you are an owner-builder, homeowner, subcontractor or developer; your state; project type, stage and value band; and contract, start, completion and payment-schedule dates you enter</td>
                  <td>When you choose to tell us, to tailor reports and reminders</td>
                </tr>
                <tr>
                  <td>Search details</td>
                  <td>Company or business name, ABN/ACN, and any director or person name you enter</td>
                  <td>Each time you run a Know Your Builder search</td>
                </tr>
                <tr>
                  <td>Saved reports and activity</td>
                  <td>Reports you save, share links you create, builders you add to a watchlist or monitoring</td>
                  <td>When you use those features</td>
                </tr>
                <tr>
                  <td>Payment details</td>
                  <td>Handled by Stripe; we receive only a payment reference and amount, never your card number</td>
                  <td>Only if you make a payment (none are currently offered)</td>
                </tr>
                <tr>
                  <td>Usage and device data</td>
                  <td>Pages visited, links clicked, browser type, IP address, approximate location</td>
                  <td>Automatically, when you use the site (see section 7)</td>
                </tr>
              </tbody>
            </table>
          </div>
          <p>
            You can browse our website without giving us personal information. You need an email address to
            receive a Know Your Builder report. If you’d rather not identify yourself, contact us and we’ll
            see whether we can help anonymously.
          </p>

          <h2>3. How we use information</h2>
          <ul>
            <li>run Know Your Builder searches and deliver, save and share your reports</li>
            <li>create and secure your account, including email verification and password resets</li>
            <li>monitor builders on your watchlist and alert you to changes, if you turn this on</li>
            <li>send service emails, such as your report link and reminders you’ve set up</li>
            <li>send product updates and waitlist news, where you’ve agreed (see section 6)</li>
            <li>understand how the site is used so we can improve it</li>
            <li>meet legal obligations and protect against misuse, for example bulk or automated searching</li>
          </ul>
          <p>
            We do not sell personal information. We do not use your information, or the information in
            reports, to train artificial intelligence or machine-learning models.
          </p>

          <h2>4. Public register data and people named in reports</h2>
          <p>
            Know Your Builder reports bring together information that government bodies, courts and tribunals
            already publish. That can include personal information about company directors, sole traders and
            licence holders, such as a name, a licence status, or a court, disciplinary or insolvency record.
          </p>
          <ul>
            <li>
              <strong>Sources:</strong> publicly available registers, including the Australian Business
              Register, ASIC, the Payment Times Reporting Register, the Modern Slavery Register, NSW and ACT
              licensing and disciplinary registers, and published court and tribunal decisions. See{' '}
              <a href="/how-it-works">how it works</a> for the full list.
            </li>
            <li>
              <strong>Purpose:</strong> we use it only to help people check a builder or contractor before
              they enter into, or continue, a building contract.
            </li>
            <li>
              <strong>Accuracy:</strong> we show each record as the source publishes it, with a link back to
              the source. We don’t add our own judgement about any individual. Records can be out of date, or
              can match a different person with a similar name. Always confirm with the original register.
            </li>
            <li>
              <strong>If you are named in a report:</strong> you can ask us to review how a record appears,
              correct a matching error, or tell us the source record has changed (see section 9). We can’t
              change the original government record; corrections to it must go to the agency that holds it.
            </li>
            <li>
              <strong>Fair use:</strong> reports are for genuine due diligence. Don’t use them to harass,
              discriminate against, or publicly shame anyone. We may suspend accounts that misuse the service.
            </li>
          </ul>

          <h2>5. Who we share information with</h2>
          <p>
            We share personal information only with service providers who help us run the service, and only
            as much as each one needs. Some of them store or process data outside Australia, mainly in the
            United States.
          </p>
          <div className="overflow-x-auto">
            <table>
              <thead>
                <tr>
                  <th>Provider</th>
                  <th>What they do for us</th>
                  <th>Likely location</th>
                </tr>
              </thead>
              <tbody>
                <tr><td>Vercel</td><td>Hosts the website and app</td><td>United States / global</td></tr>
                <tr><td>Railway</td><td>Runs the search server that queries public registers</td><td>United States</td></tr>
                <tr><td>{TBC('database host')}</td><td>Database for accounts, saved reports, watchlists and reminders</td><td>{TBC('location')}</td></tr>
                <tr><td>{TBC('Redis host')}</td><td>Queues reminder emails and monitoring jobs</td><td>{TBC('location')}</td></tr>
                <tr><td>Resend</td><td>Sends our emails</td><td>United States</td></tr>
                <tr><td>ScraperAPI and 2Captcha</td><td>Help our server reach some public registers. They see the search terms sent to those registers, which can include a company or person name</td><td>United States / other</td></tr>
                <tr><td>Google</td><td>Sign-in with Google, if you choose it</td><td>United States</td></tr>
                <tr><td>Stripe</td><td>Payment processing, if payments are offered</td><td>United States / global</td></tr>
                <tr><td>IONOS</td><td>Domain and business email</td><td>Germany / United States</td></tr>
              </tbody>
            </table>
          </div>
          <p>
            We take reasonable steps to make sure these providers protect personal information in line with
            the APPs. We may also disclose information if the law requires it, or to protect our rights or
            someone’s safety. When you create a <strong>share link</strong> for a report, anyone with that
            link can view the report until the link expires (30 days).
          </p>

          <h2>6. Emails and your choices</h2>
          <ul>
            <li>
              <strong>Service emails:</strong> your report link, account and password emails, monitoring
              alerts, and reminders you set up. These are part of the service you asked for.
            </li>
            <li>
              <strong>Marketing emails:</strong> product news and waitlist updates. We send these only if
              you’ve agreed, and each one has an unsubscribe link, in line with the <em>Spam Act 2003</em> (Cth).
            </li>
          </ul>
          <p>You can turn off reminders or monitoring at any time from your account, or by emailing {TBC('privacy email')}.</p>

          <h2>7. Cookies and analytics</h2>
          <p>
            We use essential cookies to keep you signed in and to keep the site secure. We don’t currently
            use a third-party analytics tool. Usage events are recorded in our server logs without your name
            or email. We briefly use your IP address to limit how many searches can be run in a short time,
            which protects the service from misuse.
          </p>

          <h2>8. Storage, security and retention</h2>
          <p>
            We protect personal information with encrypted connections (HTTPS), hashed passwords, access
            controls on our systems, and providers that maintain recognised security standards. No system is
            completely secure. If a data breach is likely to cause you serious harm, we will notify you and
            the Office of the Australian Information Commissioner as the Notifiable Data Breaches scheme
            requires.
          </p>
          <div className="overflow-x-auto">
            <table>
              <thead>
                <tr><th>Information</th><th>How long we keep it</th></tr>
              </thead>
              <tbody>
                <tr><td>Account details</td><td>While your account is open, then deleted within 90 days of closure</td></tr>
                <tr><td>Saved reports and search history</td><td>While your account is open, or until you delete them</td></tr>
                <tr><td>Share links</td><td>30 days from the last share</td></tr>
                <tr><td>Waitlist and marketing contacts</td><td>Until you unsubscribe</td></tr>
                <tr><td>Server logs</td><td>Up to 90 days</td></tr>
              </tbody>
            </table>
          </div>

          <h2>9. Access, correction and complaints</h2>
          <p>
            You can ask for access to the personal information we hold about you, or ask us to correct it,
            including if you’re named in a report. Email {TBC('privacy email')} with enough detail for us to
            find the record. We’ll respond within 30 days and may need to confirm your identity first. Access
            is free.
          </p>
          <p>
            If you have a privacy complaint, contact us first and we’ll try to resolve it within 30 days. If
            you’re not satisfied, you can complain to the{' '}
            <a href="https://www.oaic.gov.au/privacy/privacy-complaints" rel="noopener">
              Office of the Australian Information Commissioner
            </a>{' '}
            on 1300 363 992.
          </p>

          <h2>10. Changes and contact</h2>
          <p>
            We may update this policy as our services change. We’ll post the new version here with its
            effective date, and email account holders about significant changes.
          </p>
          <p>
            <strong>Effective date:</strong> {TBC('effective date')}
            <br />
            <strong>Privacy contact:</strong> Trustworthy Payments Pty Ltd, ABN {TBC('ABN')}, {TBC('postal address')},{' '}
            {TBC('privacy email')}
          </p>
        </Prose>
      </div>
    </>
  );
}
