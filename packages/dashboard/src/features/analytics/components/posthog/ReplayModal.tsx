import {
  Dialog,
  DialogBody,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@insforge/ui';
import { useShareToken } from '#features/analytics/hooks/useShareToken';

interface Props {
  recordingId: string | null;
  onClose: () => void;
}

// Belt-and-suspenders alongside the schema refine: never let a non-PostHog
// URL into an iframe that has `allow-same-origin`.
function isTrustedEmbedUrl(url: string | undefined): url is string {
  if (!url) {
    return false;
  }
  try {
    const { hostname } = new URL(url);
    return hostname === 'posthog.com' || hostname.endsWith('.posthog.com');
  } catch {
    return false;
  }
}

export function ReplayModal({ recordingId, onClose }: Props) {
  const open = !!recordingId;
  const { data, isLoading, error } = useShareToken(recordingId, open);
  const safeUrl = isTrustedEmbedUrl(data?.embedUrl) ? data?.embedUrl : null;

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
            {safeUrl && (
              <iframe
                src={safeUrl}
                title="Session replay"
                className="h-full w-full border-0"
                allowFullScreen
                sandbox="allow-scripts allow-same-origin allow-popups allow-popups-to-escape-sandbox"
                referrerPolicy="no-referrer"
              />
            )}
            {!isLoading && !error && data?.embedUrl && !safeUrl && (
              <div className="flex h-full items-center justify-center text-sm text-destructive">
                Refusing to embed replay from untrusted origin.
              </div>
            )}
          </div>
        </DialogBody>
      </DialogContent>
    </Dialog>
  );
}
