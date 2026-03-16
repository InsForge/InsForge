import { useState, useEffect, useCallback } from 'react';
import {
  Button,
  Dialog,
  DialogBody,
  DialogContent,
  DialogDivider,
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
import { useToast } from '@/lib/hooks/useToast';
import { realtimeService } from '../services/realtime.service';

interface RealtimeSettingsMenuDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onConfigSaved?: () => void;
}

export function RealtimeSettingsMenuDialog({
  open,
  onOpenChange,
  onConfigSaved,
}: RealtimeSettingsMenuDialogProps) {
  const [retentionDays, setRetentionDays] = useState<string>('30');
  const [isLoading, setIsLoading] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [isCleaning, setIsCleaning] = useState(false);
  const { showToast } = useToast();

  const fetchConfig = useCallback(async () => {
    setIsLoading(true);
    try {
      const config = await realtimeService.getRetentionConfig();
      setRetentionDays(config.retentionDays === null ? 'never' : String(config.retentionDays));
    } catch (error) {
      console.error('Failed to fetch realtime config', error);
      showToast('Failed to fetch realtime configuration.', 'error');
    } finally {
      setIsLoading(false);
    }
  }, [showToast]);

  useEffect(() => {
    if (open) {
      void fetchConfig();
    }
  }, [open, fetchConfig]);

  const handleSave = async () => {
    setIsSaving(true);
    try {
      const value = retentionDays === 'never' ? null : Number(retentionDays);
      await realtimeService.updateRetentionConfig(value);
      showToast('Retention settings saved successfully.', 'success');
      onConfigSaved?.();
      onOpenChange(false);
    } catch (error) {
      console.error('Failed to save realtime config', error);
      showToast('Failed to save retention settings.', 'error');
    } finally {
      setIsSaving(false);
    }
  };

  const handleCleanup = async () => {
    if (!confirm('Are you sure you want to clean up old messages? This action cannot be undone.')) {
      return;
    }
    setIsCleaning(true);
    try {
      const result = await realtimeService.cleanupMessages();
      showToast(result.message || 'Old messages have been pruned.', 'success');
    } catch (error) {
      console.error('Failed to cleanup messages', error);
      showToast('Failed to trigger manual cleanup.', 'error');
    } finally {
      setIsCleaning(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Realtime Settings</DialogTitle>
        </DialogHeader>

        <DialogBody className="gap-4">
          <div className="flex gap-6 items-center">
            <div className="w-[200px] shrink-0">
              <Label htmlFor="retention-days" className="leading-5 text-foreground">
                Message Retention
              </Label>
              <p className="text-[13px] leading-[18px] text-muted-foreground mt-1">
                How long to keep messages before automatic pruning.
              </p>
            </div>
            <div className="min-w-0 flex-1">
              <Select value={retentionDays} onValueChange={setRetentionDays} disabled={isLoading}>
                <SelectTrigger id="retention-days" className="h-9 w-full">
                  <SelectValue placeholder="Select retention" />
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

          <DialogDivider />

          <div className="flex gap-6 items-center">
            <div className="w-[200px] shrink-0">
              <Label className="leading-5 text-foreground">Manual Cleanup</Label>
              <p className="text-[13px] leading-[18px] text-muted-foreground mt-1">
                Trigger manual cleanup based on threshold.
              </p>
            </div>
            <div className="min-w-0 flex-1 flex justify-end">
              <Button
                variant="destructive"
                size="sm"
                onClick={() => void handleCleanup()}
                disabled={isCleaning || isLoading}
              >
                {isCleaning ? 'Cleaning...' : 'Clean up now'}
              </Button>
            </div>
          </div>
        </DialogBody>

        <DialogFooter>
          <Button
            type="button"
            variant="secondary"
            onClick={() => onOpenChange(false)}
            className="h-8 rounded px-3"
          >
            Cancel
          </Button>
          <Button
            type="button"
            onClick={() => void handleSave()}
            disabled={isSaving || isLoading}
            className="h-8 rounded px-3"
          >
            {isSaving ? 'Saving...' : 'Save Changes'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
