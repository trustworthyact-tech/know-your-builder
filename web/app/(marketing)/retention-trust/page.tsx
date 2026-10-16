import type { Metadata } from 'next';
import { PageHeader, Prose } from '@/components/marketing/ui';
import { WaitlistForm } from '@/components/marketing/WaitlistForm';

export const metadata: Metadata = {
  title: 'Digital Retention Trust for NSW and ACT construction',
  description:
    'Digital Retention Trust is coming soon: retention money held in a trust account and released when the defects liability period ends. NSW and ACT.',
  alternates: { canonical: '/retention-trust' },
};

export default function RetentionTrustPage() {
  return (
    <>
      <PageHeader
        eyebrow="Coming soon · After completion"
        title="Get your retention money back, on time."
        lead="Digital Retention Trust will hold retention money in a dedicated trust account and track each release date, so subcontractors are paid when the defects liability period ends. NSW and ACT first."
        crumbs={[
          { href: '/', label: 'Home' },
          { href: '/retention-trust', label: 'Digital Retention Trust' },
        ]}
      >
        <div className="max-w-xl pt-2">
          <WaitlistForm product="retention_trust" />
        </div>
      </PageHeader>

      <div className="mx-auto max-w-6xl px-4 py-14 sm:px-6">
        <Prose>
          <h2>The problem it solves</h2>
          <p>
            Retention is the slice of each progress payment held back as security for defects, often 5%
            of the contract. It is the money subcontractors are most likely to lose when a builder fails,
            and it is often released late, or not at all, even on healthy projects.
          </p>
          <h2>What we’re building</h2>
          <ul>
            <li>Retention paid into a dedicated trust account, separate from the builder’s operating funds.</li>
            <li>A ledger every party can see: what’s held, for which subcontract, and when it’s due back.</li>
            <li>Reminders before each release date, and an audit trail of every deposit and release.</li>
          </ul>
          <h2>Who it’s for</h2>
          <p>
            Builders and head contractors who must hold retention in trust, and the subcontractors whose
            money it is. We’re starting in NSW and the ACT.
          </p>
          <p>
            In the meantime, you can <a href="/check">check a builder for free</a> before you sign the
            subcontract.
          </p>
        </Prose>
      </div>
    </>
  );
}
