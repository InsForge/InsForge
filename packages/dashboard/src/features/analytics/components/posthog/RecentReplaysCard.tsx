import { useState } from 'react';
import type { PosthogRecordingItem } from '@insforge/shared-schemas';
import { EmptyState, ErrorState, LoadingState } from '#components';
import { formatDuration, formatRelativeTime, truncateId } from '#features/analytics/lib/format';
import { ReplayModal } from './ReplayModal';

export function RecentReplaysCard({
  items,
  isLoading,
  error,
}: {
  items: PosthogRecordingItem[];
  isLoading: boolean;
  error: unknown;
}) {
  const [openId, setOpenId] = useState<string | null>(null);

  if (isLoading) {
    return <LoadingState className="py-6" message="Loading replays…" />;
  }

  if (error) {
    return <ErrorState title="Failed to load replays" error="Please try again." />;
  }

  if (items.length === 0) {
    return <EmptyState title="No data available" className="py-12" />;
  }

  return (
    <>
      <ul className="flex flex-col">
        {items.map((rec) => (
          <li key={rec.id} className="border-b border-[var(--alpha-8)] last:border-b-0">
            <button
              type="button"
              className="flex w-full flex-col gap-1 px-4 py-3 text-left transition-colors hover:bg-alpha-4"
              onClick={() => setOpenId(rec.id)}
            >
              <div className="flex items-center justify-between gap-3">
                <span className="font-mono text-sm text-foreground">{truncateId(rec.id)}</span>
                <span className="text-sm text-muted-foreground">
                  {formatDuration(rec.durationSeconds)}
                </span>
              </div>
              <div className="flex items-center justify-between gap-3 text-sm text-muted-foreground">
                <span className="truncate">{rec.startUrl ?? '(no url)'}</span>
                <span className="shrink-0">{formatRelativeTime(rec.startTime)}</span>
              </div>
            </button>
          </li>
        ))}
      </ul>
      <ReplayModal recordingId={openId} onClose={() => setOpenId(null)} />
    </>
  );
}
