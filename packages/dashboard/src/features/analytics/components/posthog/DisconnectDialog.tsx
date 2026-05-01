import { useMutation, useQueryClient } from '@tanstack/react-query';
import {
  Button,
  Dialog,
  DialogBody,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@insforge/ui';
import { posthogApi } from '../../services/posthog.api';

export function DisconnectDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const qc = useQueryClient();
  const m = useMutation({
    mutationFn: () => posthogApi.disconnect(),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['posthog'] });
      onClose();
    },
  });

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Disconnect PostHog?</DialogTitle>
          <DialogDescription className="sr-only">
            Remove your PostHog integration from this project.
          </DialogDescription>
        </DialogHeader>
        <DialogBody>
          <p className="text-sm text-foreground">
            Insforge will stop using your PostHog credentials. Your PostHog project itself will not
            be deleted; you can reconnect anytime.
          </p>
        </DialogBody>
        <DialogFooter>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button variant="destructive" disabled={m.isPending} onClick={() => m.mutate()}>
            {m.isPending ? 'Disconnecting…' : 'Disconnect'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
