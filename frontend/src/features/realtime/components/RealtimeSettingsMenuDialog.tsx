import { useEffect, useState } from 'react';
import {
  Button,
  Dialog,
  DialogBody,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@insforge/ui';
import { Label } from '@/components';
import { useRealtimeConfig } from '../hooks/useRealtimeConfig';

interface RealtimeSettingsMenuDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

type RetentionOption = string;

function toRetentionOption(retentionDays: number | null): RetentionOption {
  return retentionDays === null ? 'never' : String(retentionDays);
}

export function RealtimeSettingsMenuDialog({
  open,
  onOpenChange,
}: RealtimeSettingsMenuDialogProps) {
  const [retentionDays, setRetentionDays] = useState<RetentionOption | null>(null);
  const [initialRetentionDays, setInitialRetentionDays] = useState<RetentionOption | null>(null);
  const { config, isLoading, isUpdating, error, updateConfig } = useRealtimeConfig();

  useEffect(() => {
    if (!open) {
      setRetentionDays(null);
      setInitialRetentionDays(null);
      return;
    }

    if (!config) {
      return;
    }

    const nextRetentionDays = toRetentionOption(config.retentionDays);
    setRetentionDays(nextRetentionDays);
    setInitialRetentionDays(nextRetentionDays);
  }, [config, open]);

  const isLoaded = retentionDays !== null && initialRetentionDays !== null;
  const hasChanges = isLoaded && retentionDays !== initialRetentionDays;
  const canClose = !isUpdating;
  const isSelectDisabled = !isLoaded || isLoading || isUpdating;

  const handleOpenChange = (nextOpen: boolean) => {
    if (!canClose) {
      return;
    }
    onOpenChange(nextOpen);
  };

  const handleSave = async () => {
    if (!isLoaded || !hasChanges) {
      return;
    }

    await updateConfig({
      retentionDays: retentionDays === 'never' ? null : Number(retentionDays),
    });
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent showCloseButton={canClose}>
        <DialogHeader>
          <DialogTitle>Realtime Settings</DialogTitle>
          <DialogDescription>
            Configure how long realtime messages are retained before pruning.
          </DialogDescription>
        </DialogHeader>

        <DialogBody className="gap-4">
          {!isLoaded ? (
            <div className="flex min-h-[92px] items-center justify-center text-sm text-muted-foreground">
              {isLoading && !error ? 'Loading configuration...' : 'Unable to load configuration.'}
            </div>
          ) : (
            <div className="flex gap-6 items-center">
              <div className="w-[200px] shrink-0">
                <Label htmlFor="retention-days" className="leading-5 text-foreground">
                  Message Retention
                </Label>
                <p className="mt-1 whitespace-nowrap text-[13px] leading-[18px] text-muted-foreground">
                  How long messages are kept before pruning.
                </p>
              </div>
              <div className="min-w-0 flex-1 flex justify-end">
                <Select
                  value={retentionDays ?? undefined}
                  onValueChange={setRetentionDays}
                  disabled={isSelectDisabled}
                >
                  <SelectTrigger id="retention-days" className="h-9 w-[180px] max-w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="30">30 days</SelectItem>
                    <SelectItem value="90">90 days</SelectItem>
                    <SelectItem value="180">180 days</SelectItem>
                    <SelectItem value="never">Never</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
          )}
        </DialogBody>

        <DialogFooter>
          <Button
            type="button"
            variant="secondary"
            onClick={() => handleOpenChange(false)}
            disabled={!canClose}
            className="h-8 rounded px-3"
          >
            Cancel
          </Button>
          <Button
            type="button"
            onClick={() => void handleSave()}
            disabled={!isLoaded || isUpdating || !hasChanges}
            className="h-8 rounded px-3"
          >
            {isUpdating ? 'Saving...' : 'Save Changes'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
