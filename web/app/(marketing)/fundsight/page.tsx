import type { Metadata } from 'next';
import { PageHeader, Prose } from '@/components/marketing/ui';
import { WaitlistForm } from '@/components/marketing/WaitlistForm';

export const metadata: Metadata = {
  title: 'FundSight: see project funds before you build',
  description:
    'FundSight is coming soon: real-time visibility of construction project funds, so subcontractors and developers know the money is there before work starts.',
  alternates: { canonical: '/fundsight' },
};

export default function FundSightPage() {
  return (
    <>
      <PageHeader
        eyebrow="Coming soon · During the build"
        title="Know the money is there before the work starts."
        lead="FundSight will give subcontractors and developers real-time visibility of a project’s funds, using bank data shared with the project owner’s consent."
        crumbs={[
          { href: '/', label: 'Home' },
          { href: '/fundsight', label: 'FundSight' },
        ]}
      >
        <div className="max-w-xl pt-2">
          <WaitlistForm product="fundsight" />
        </div>
      </PageHeader>

      <div className="mx-auto max-w-6xl px-4 py-14 sm:px-6">
        <Prose>
          <h2>The problem it solves</h2>
          <p>
            Most payment disputes on a building site start the same way: work is done, a claim goes
            in, and the money isn’t there. Subcontractors usually find out after they’ve bought the
            materials and paid their crews.
          </p>
          <h2>What we’re building</h2>
          <ul>
            <li>A live view of the project account balance against what’s been claimed and certified.</li>
            <li>Alerts when the balance drops below upcoming progress payments.</li>
            <li>Read-only access through Australia’s Consumer Data Right (Open Banking), so no one shares bank passwords.</li>
          </ul>
          <h2>Who it’s for</h2>
          <p>
            Subcontractors deciding whether to take on or keep working on a job, and developers who want
            to show their trades the project is funded.
          </p>
          <p>
            In the meantime, you can <a href="/check">check the head contractor or builder for free</a>{' '}
            with Know Your Builder.
          </p>
        </Prose>
      </div>
    </>
  );
}
