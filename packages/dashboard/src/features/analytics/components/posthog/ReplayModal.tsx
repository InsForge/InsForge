import {
  Dialog,
  DialogBody,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@insforge/ui';
import { useShareToken } from '../../hooks/useShareToken';

interface Props {
  recordingId: string | null;
  onClose: () => void;
}

export function ReplayModal({ recordingId, onClose }: Props) {
  const open = !!recordingId;
  const { data, isLoading, error } = useShareToken(recordingId, open);

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="max-w-4xl">
        <DialogHeader>
          <DialogTitle>Session replay</DialogTitle>
          <DialogDescription className="sr-only">
            Embedded PostHog session recording playback.
          </DialogDescription>
        </DialogHeader>
        <DialogBody>
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
        </DialogBody>
      </DialogContent>
    </Dialog>
  );
}
