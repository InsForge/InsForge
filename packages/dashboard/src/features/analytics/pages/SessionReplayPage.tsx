import { useMemo, useState } from 'react';
import { PaginationControls } from '#components';
import { useRecordings } from '#features/analytics/hooks/useRecordings';
import { RecentReplaysCard } from '#features/analytics/components/posthog/RecentReplaysCard';
import { TimeRangeSelector } from '#features/analytics/components/posthog/TimeRangeSelector';

const WINDOW_SIZE = 50;
const PAGE_SIZE = 10;

export function SessionReplayPage() {
  const { data, isLoading, error } = useRecordings(WINDOW_SIZE, true);
  const [page, setPage] = useState(1);

  const allItems = data?.items ?? [];
  const totalPages = Math.max(1, Math.ceil(allItems.length / PAGE_SIZE));
  const pageItems = useMemo(
    () => allItems.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE),
    [allItems, page]
  );

  return (
    <div className="flex flex-col gap-4 p-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold text-foreground">Session Replay</h1>
        <TimeRangeSelector />
      </div>

      <RecentReplaysCard items={pageItems} isLoading={isLoading} error={error} />

      {allItems.length > PAGE_SIZE && (
        <PaginationControls
          currentPage={page}
          totalPages={totalPages}
          totalRecords={allItems.length}
          pageSize={PAGE_SIZE}
          recordLabel="replays"
          onPageChange={setPage}
        />
      )}
    </div>
  );
}
