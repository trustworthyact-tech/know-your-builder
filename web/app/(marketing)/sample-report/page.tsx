import type { Metadata } from 'next';
import { PageHeader, Prose, SearchBand } from '@/components/marketing/ui';
import { SampleReport } from '@/components/marketing/SampleReport';

export const metadata: Metadata = {
  title: 'Sample builder report',
  description:
    'See a real Know Your Builder report for a NSW builder, with identifying details removed: licence, court, insolvency and corporate checks in one place.',
  alternates: { canonical: '/sample-report' },
};

export default function SampleReportPage() {
  return (
    <>
      <PageHeader
        eyebrow="Sample report"
        title="What a Know Your Builder report looks like."
        lead="This is a real report for a large NSW residential builder. We’ve removed the builder’s name and anything that would identify it. Open each section to see what was checked."
        crumbs={[
          { href: '/', label: 'Home' },
          { href: '/sample-report', label: 'Sample report' },
        ]}
      />
      <div className="mx-auto grid max-w-4xl gap-12 px-4 py-12 sm:px-6">
        <SampleReport />
        <Prose>
          <h2>How to read it</h2>
          <ul>
            <li>
              <strong>Findings aren’t verdicts.</strong> This builder holds a current licence. The compliance
              history and the tribunal decision are things to read and ask about, not reasons on their own to
              walk away.
            </li>
            <li>
              <strong>Clear means nothing was found</strong> in that source on the day of the search. It isn’t
              a guarantee.
            </li>
            <li>
              <strong>“For information” results</strong> aren’t risks. Most small builders don’t report payment
              times, and a builder working only in NSW won’t hold an ACT licence.
            </li>
          </ul>
        </Prose>
      </div>
      <SearchBand title="Run the same check on your builder." />
    </>
  );
}
