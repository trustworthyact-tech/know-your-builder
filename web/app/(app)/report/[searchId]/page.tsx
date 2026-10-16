import { Suspense } from 'react';
import { ReportContent } from './ReportContent';

interface Props {
  params: { searchId: string };
}

export default function ReportPage({ params }: Props) {
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
      <ReportContent searchId={params.searchId} />
    </Suspense>
  );
}
