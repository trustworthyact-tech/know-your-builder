import { Suspense } from 'react';
import { ReportContent } from '../../[searchId]/ReportContent';

interface Props {
  params: { token: string };
}

export default function SharedReportPage({ params }: Props) {
  return (
    <Suspense
      fallback={
        <div className="min-h-screen bg-background flex items-center justify-center">
          <div
            className="w-8 h-8 border-4 border-primary border-t-transparent rounded-full animate-spin"
            role="status"
            aria-label="Loading report"
          />
        </div>
      }
    >
      <ReportContent searchId="" shareToken={params.token} readOnly />
    </Suspense>
  );
}
