import { useMemo, useState } from 'react';
import { PaginationControls, TableHeader } from '#components';
import { useRecordings } from '#features/analytics/hooks/useRecordings';
import { SessionRow } from '#features/analytics/components/posthog/SessionRow';
import { ReplayModal } from '#features/analytics/components/posthog/ReplayModal';

const WINDOW_SIZE = 50;
const PAGE_SIZE = 10;

export function SessionReplayPage() {
  const { data, isLoading, error } = useRecordings(WINDOW_SIZE, true);
  const [page, setPage] = useState(1);
  const [openId, setOpenId] = useState<string | null>(null);

  const allItems = useMemo(() => data?.items ?? [], [data?.items]);
  const totalPages = Math.max(1, Math.ceil(allItems.length / PAGE_SIZE));
  const safePage = Math.min(page, totalPages);
  const pageItems = useMemo(
    () => allItems.slice((safePage - 1) * PAGE_SIZE, safePage * PAGE_SIZE),
    [allItems, safePage]
  );

  return (
    <div className="flex h-full min-h-0 flex-col overflow-hidden bg-semantic-1">
      <TableHeader title="Session Replay" showSearch={false} />

      <div className="min-h-0 flex-1 overflow-y-auto">
        <div className="mx-auto w-4/5 max-w-[1024px] pb-10 pt-10">
          {/* Table header */}
          <div className="flex items-center pl-1.5">
            <div className="flex h-8 flex-1 items-center px-2.5">
              <span className="text-sm text-muted-foreground">Replay</span>
            </div>
            <div className="flex h-8 flex-[1.5] items-center px-2.5">
              <span className="text-sm text-muted-foreground">Link</span>
            </div>
            <div className="flex h-8 w-24 items-center px-2.5">
              <span className="text-sm text-muted-foreground">Duration</span>
            </div>
            <div className="flex h-8 flex-1 items-center px-2.5">
              <span className="text-sm text-muted-foreground">Time Recorded</span>
            </div>
          </div>

          {/* Table body */}
          <div className="mt-1 flex flex-col gap-1">
            {isLoading ? (
              <div className="px-2.5 py-4 text-sm text-muted-foreground">Loading…</div>
            ) : error ? (
              <div className="px-2.5 py-4 text-sm text-destructive">Failed to load replays.</div>
            ) : pageItems.length === 0 ? (
              <div className="px-2.5 py-4 text-sm text-muted-foreground">
                No replays yet. Make sure session_recording is enabled in your PostHog project.
              </div>
            ) : (
              pageItems.map((rec) => (
                <SessionRow key={rec.id} recording={rec} onOpen={setOpenId} />
              ))
            )}
          </div>
        </div>
      </div>

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

      <ReplayModal recordingId={openId} onClose={() => setOpenId(null)} />
    </div>
  );
}
