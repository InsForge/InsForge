import { useEffect } from 'react';
import { useShareToken } from '../../hooks/useShareToken';

interface Props {
  recordingId: string | null;
  onClose: () => void;
}

export function ReplayModal({ recordingId, onClose }: Props) {
  const open = !!recordingId;
  const { data, isLoading, error } = useShareToken(recordingId, open);

  useEffect(() => {
    if (!open) {
      return;
    }
    function onEsc(e: KeyboardEvent) {
      if (e.key === 'Escape') {
        onClose();
      }
    }
    window.addEventListener('keydown', onEsc);
    return () => window.removeEventListener('keydown', onEsc);
  }, [open, onClose]);

  if (!open) {
    return null;
  }

  return (
    <div
      role="dialog"
      aria-modal="true"
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
      onClick={onClose}
    >
      <div
        className="relative flex w-full max-w-4xl flex-col gap-2 rounded-lg border bg-card p-4 shadow-lg"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between">
          <h3 className="text-sm font-semibold text-foreground">Session replay</h3>
          <button
            type="button"
            className="text-sm text-muted-foreground hover:text-foreground"
            onClick={onClose}
            aria-label="Close"
          >
            ✕
          </button>
        </div>
        <div className="aspect-video w-full overflow-hidden rounded bg-muted">
          {isLoading && (
            <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
              Generating share link…
            </div>
          )}
          {error && (
            <div className="flex h-full items-center justify-center text-sm text-destructive">
              Failed to load replay.
            </div>
          )}
          {data?.embedUrl && (
            <iframe
              src={data.embedUrl}
              title="Session replay"
              className="h-full w-full border-0"
              allowFullScreen
            />
          )}
        </div>
      </div>
    </div>
  );
}
