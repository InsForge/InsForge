import { formatDistance } from 'date-fns';
import type { PosthogRecordingItem } from '@insforge/shared-schemas';
import { formatDuration, truncateId } from '#features/analytics/lib/format';

interface SessionRowProps {
  recording: PosthogRecordingItem;
  onOpen: (id: string) => void;
}

export function SessionRow({ recording, onOpen }: SessionRowProps) {
  return (
    <button
      type="button"
      onClick={() => onOpen(recording.id)}
      className="group block w-full rounded border border-[var(--alpha-8)] bg-card text-left"
    >
      <div className="flex items-center rounded pl-1.5 transition-colors hover:bg-[var(--alpha-8)]">
        {/* Session ID */}
        <div className="flex h-12 min-w-0 flex-1 items-center px-2.5">
          <p className="truncate font-mono text-sm text-foreground" title={recording.id}>
            {truncateId(recording.id)}
          </p>
        </div>

        {/* URL */}
        <div className="flex h-12 min-w-0 flex-[1.5] items-center px-2.5">
          <span className="truncate text-sm text-foreground" title={recording.startUrl ?? ''}>
            {recording.startUrl ?? '(no url)'}
          </span>
        </div>

        {/* Duration */}
        <div className="flex h-12 w-24 shrink-0 items-center px-2.5">
          <span className="text-sm text-muted-foreground">
            {formatDuration(recording.durationSeconds)}
          </span>
        </div>

        {/* Started */}
        <div className="flex h-12 min-w-0 flex-1 items-center px-2.5">
          <span className="truncate text-sm text-foreground">
            {formatDistance(new Date(recording.startTime), new Date(), { addSuffix: true })}
          </span>
        </div>
      </div>
    </button>
  );
}
