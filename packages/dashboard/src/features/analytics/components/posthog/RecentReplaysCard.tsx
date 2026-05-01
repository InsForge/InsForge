import { useState } from 'react';
import { useRecordings } from '../../hooks/useRecordings';
import { formatDuration, formatRelativeTime, truncateId } from '../../lib/format';
import { ReplayModal } from './ReplayModal';

export function RecentReplaysCard({ enabled }: { enabled: boolean }) {
  const { data, isLoading, error } = useRecordings(10, enabled);
  const [openId, setOpenId] = useState<string | null>(null);

  if (isLoading) {
    return (
      <div className="rounded-lg bg-card p-4">
        <h3 className="mb-3 text-sm font-semibold text-foreground">Recent replays</h3>
        <div className="text-sm text-muted-foreground">Loading…</div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="rounded-lg bg-destructive/10 p-4">
        <h3 className="mb-3 text-sm font-semibold text-destructive">Recent replays</h3>
        <div className="text-sm text-destructive">Failed to load replays.</div>
      </div>
    );
  }

  const items = data?.items ?? [];
  if (items.length === 0) {
    return (
      <div className="rounded-lg bg-card p-4">
        <h3 className="mb-3 text-sm font-semibold text-foreground">Recent replays</h3>
        <div className="text-sm text-muted-foreground">
          No replays yet. Make sure session_recording is enabled in your PostHog project.
        </div>
      </div>
    );
  }

  return (
    <>
      <div className="rounded-lg bg-card p-4">
        <h3 className="mb-3 text-sm font-semibold text-foreground">Recent replays</h3>
        <ul className="divide-y">
          {items.map((rec) => (
            <li key={rec.id}>
              <button
                type="button"
                className="w-full px-2 py-2 text-left text-sm hover:bg-accent"
                onClick={() => setOpenId(rec.id)}
              >
                <div className="flex items-center justify-between gap-3">
                  <span className="font-mono text-xs text-foreground">
                    {truncateId(rec.distinctId)}
                  </span>
                  <span className="text-xs text-muted-foreground">
                    {formatDuration(rec.durationSeconds)}
                  </span>
                </div>
                <div className="mt-1 flex items-center justify-between gap-3 text-xs text-muted-foreground">
                  <span className="truncate">{rec.startUrl ?? '(no url)'}</span>
                  <span className="shrink-0">{formatRelativeTime(rec.startTime)}</span>
                </div>
              </button>
            </li>
          ))}
        </ul>
      </div>
      <ReplayModal recordingId={openId} onClose={() => setOpenId(null)} />
    </>
  );
}
