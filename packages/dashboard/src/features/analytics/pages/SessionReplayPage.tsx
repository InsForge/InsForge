import { useMemo, useState } from 'react';
import { PaginationControls } from '#components';
import { useRecordings } from '#features/analytics/hooks/useRecordings';
import { RecentReplaysCard } from '#features/analytics/components/posthog/RecentReplaysCard';

const WINDOW_SIZE = 50;
const PAGE_SIZE = 10;

export function SessionReplayPage() {
  const { data, isLoading, error } = useRecordings(WINDOW_SIZE, true);
  const [page, setPage] = useState(1);

  const allItems = useMemo(() => data?.items ?? [], [data?.items]);
  const totalPages = Math.max(1, Math.ceil(allItems.length / PAGE_SIZE));
  const safePage = Math.min(page, totalPages);
  const pageItems = useMemo(
    () => allItems.slice((safePage - 1) * PAGE_SIZE, safePage * PAGE_SIZE),
    [allItems, safePage]
  );

  return (
    <div className="flex flex-col gap-4 p-6">
      <h1 className="text-2xl font-bold text-foreground">Session Replay</h1>

      <RecentReplaysCard items={pageItems} isLoading={isLoading} error={error} />

      {allItems.length > PAGE_SIZE && (
        <PaginationControls
          currentPage={safePage}
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
