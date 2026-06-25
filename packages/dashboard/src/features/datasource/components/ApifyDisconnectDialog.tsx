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
import { datasourceQueryKeys } from '#features/datasource/hooks/useDatasource';
import { datasourceService } from '#features/datasource/services/datasource.service';
import { useToast } from '#lib/hooks/useToast';

export function ApifyDisconnectDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const qc = useQueryClient();
  const { showToast } = useToast();
  const m = useMutation({
    mutationFn: () => datasourceService.disconnectApify(),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: datasourceQueryKeys.all });
      showToast('Apify disconnected.', 'info');
      onClose();
    },
    onError: () => {
      showToast('Failed to disconnect Apify. Please try again.', 'error');
    },
  });

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Disconnect Apify?</DialogTitle>
          <DialogDescription className="sr-only">
            Remove your Apify integration from this project.
          </DialogDescription>
        </DialogHeader>
        <DialogBody>
          <p className="text-sm text-foreground">
            Insforge will stop using your Apify credentials. Your Apify account itself will not be
            deleted; you can reconnect anytime.
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
