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
import { analyticsQueryKeys } from '#features/analytics/hooks/useAnalytics';
import { analyticsService } from '#features/analytics/services/analytics.service';

export function DisconnectDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { t } = useTranslation('chrome');
  const qc = useQueryClient();
  const { showToast } = useToast();
  const m = useMutation({
    mutationFn: () => analyticsService.disconnect(),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: analyticsQueryKeys.all });
      onClose();
    },
    onError: () => {
      showToast(
        t('analytics.disconnectFailed', {
          defaultValue: 'Failed to disconnect PostHog. Please try again.',
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
            {t('analytics.disconnectTitle', { defaultValue: 'Disconnect PostHog?' })}
          </DialogTitle>
          <DialogDescription className="sr-only">
            {t('analytics.disconnectSrDescription', {
              defaultValue: 'Remove your PostHog integration from this project.',
            })}
          </DialogDescription>
        </DialogHeader>
        <DialogBody>
          <p className="text-sm text-foreground">
            {t('analytics.disconnectBody', {
              defaultValue:
                'Insforge will stop using your PostHog credentials. Your PostHog project itself will not be deleted; you can reconnect anytime.',
            })}
          </p>
        </DialogBody>
        <DialogFooter>
          <Button variant="ghost" onClick={onClose}>
            {t('analytics.cancel', { defaultValue: 'Cancel' })}
          </Button>
          <Button variant="destructive" disabled={m.isPending} onClick={() => m.mutate()}>
            {m.isPending
              ? t('analytics.disconnecting', { defaultValue: 'Disconnecting…' })
              : t('analytics.config.disconnect', { defaultValue: 'Disconnect' })}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
