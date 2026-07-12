import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import {
  Button,
  Dialog,
  DialogBody,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  useToast,
} from '@insforge/ui';
import { webscraperQueryKeys } from '#features/webscraper/hooks/useWebscraper';
import { webscraperService } from '#features/webscraper/services/webscraper.service';

export function WebScraperDisconnectDialog({
  open,
  onClose,
}: {
  open: boolean;
  onClose: () => void;
}) {
  const { t } = useTranslation('chrome');
  const qc = useQueryClient();
  const { showToast } = useToast();
  const m = useMutation({
    mutationFn: () => webscraperService.disconnectApify(),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: webscraperQueryKeys.all });
      showToast(t('webscraper.apifyDisconnected', { defaultValue: 'Apify disconnected.' }), 'info');
      onClose();
    },
    onError: () => {
      showToast(
        t('webscraper.disconnectApifyFailed', {
          defaultValue: 'Failed to disconnect Apify. Please try again.',
        }),
        'error'
      );
    },
  });

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>
            {t('webscraper.disconnectApifyTitle', { defaultValue: 'Disconnect Apify?' })}
          </DialogTitle>
          <DialogDescription className="sr-only">
            {t('webscraper.disconnectApifyDescription', {
              defaultValue: 'Remove your Apify integration from this project.',
            })}
          </DialogDescription>
        </DialogHeader>
        <DialogBody>
          <p className="text-sm text-foreground">
            {t('webscraper.disconnectApifyBody', {
              defaultValue:
                'Insforge will stop using your Apify credentials. Your Apify account itself will not be deleted; you can reconnect anytime.',
            })}
          </p>
        </DialogBody>
        <DialogFooter>
          <Button variant="ghost" onClick={onClose}>
            {t('webscraper.cancel', { defaultValue: 'Cancel' })}
          </Button>
          <Button variant="destructive" disabled={m.isPending} onClick={() => m.mutate()}>
            {m.isPending
              ? t('webscraper.disconnecting', { defaultValue: 'Disconnecting…' })
              : t('webscraper.disconnect', { defaultValue: 'Disconnect' })}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
