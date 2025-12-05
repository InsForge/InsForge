import { useState, useEffect } from 'react';
import { Plus, X } from 'lucide-react';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
  Button,
  Input,
  Label,
  Switch,
  Textarea,
} from '@/components';
import type { RealtimeChannel } from '../services/realtime.service';
import type { UpdateChannelRequest } from '@insforge/shared-schemas';

interface EditChannelModalProps {
  channel: RealtimeChannel | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSave: (id: string, data: UpdateChannelRequest) => void;
  isUpdating?: boolean;
}

export function EditChannelModal({
  channel,
  open,
  onOpenChange,
  onSave,
  isUpdating,
}: EditChannelModalProps) {
  const [pattern, setPattern] = useState('');
  const [description, setDescription] = useState('');
  const [enabled, setEnabled] = useState(true);
  const [webhookUrls, setWebhookUrls] = useState<string[]>(['']);

  useEffect(() => {
    if (channel) {
      setPattern(channel.pattern);
      setDescription(channel.description || '');
      setEnabled(channel.enabled);
      // Default to at least one empty input if no webhooks configured
      const urls =
        channel.webhookUrls && channel.webhookUrls.length > 0 ? channel.webhookUrls : [''];
      setWebhookUrls(urls);
    }
  }, [channel]);

  const handleAddWebhook = () => {
    setWebhookUrls([...webhookUrls, '']);
  };

  const handleRemoveWebhook = (index: number) => {
    if (webhookUrls.length === 1) {
      // Keep at least one input, just clear it
      setWebhookUrls(['']);
    } else {
      setWebhookUrls(webhookUrls.filter((_, i) => i !== index));
    }
  };

  const handleWebhookChange = (index: number, value: string) => {
    const updated = [...webhookUrls];
    updated[index] = value;
    setWebhookUrls(updated);
  };

  const handleSave = () => {
    if (!channel) {
      return;
    }

    const updates: UpdateChannelRequest = {};

    if (pattern !== channel.pattern) {
      updates.pattern = pattern;
    }
    if (description !== (channel.description || '')) {
      updates.description = description || undefined;
    }
    if (enabled !== channel.enabled) {
      updates.enabled = enabled;
    }

    // Filter out empty webhook URLs and compare
    const filteredWebhooks = webhookUrls.filter((url) => url.trim() !== '');
    const originalWebhooks = channel.webhookUrls || [];
    const webhooksChanged =
      filteredWebhooks.length !== originalWebhooks.length ||
      filteredWebhooks.some((url, i) => url !== originalWebhooks[i]);

    if (webhooksChanged) {
      updates.webhookUrls = filteredWebhooks;
    }

    onSave(channel.id, updates);
  };

  const hasChanges = () => {
    if (!channel) {
      return false;
    }

    const filteredWebhooks = webhookUrls.filter((url) => url.trim() !== '');
    const originalWebhooks = channel.webhookUrls || [];
    const webhooksChanged =
      filteredWebhooks.length !== originalWebhooks.length ||
      filteredWebhooks.some((url, i) => url !== originalWebhooks[i]);

    return (
      pattern !== channel.pattern ||
      description !== (channel.description || '') ||
      enabled !== channel.enabled ||
      webhooksChanged
    );
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-[560px] dark:bg-neutral-800 p-0 gap-0">
        <DialogHeader className="px-6 py-4 border-b border-zinc-200 dark:border-neutral-700">
          <DialogTitle className="text-lg font-semibold text-zinc-950 dark:text-white">
            Edit Channel
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-6 p-6">
          {/* Pattern */}
          <div className="flex flex-row justify-between gap-6">
            <Label
              htmlFor="pattern"
              className="w-28 shrink-0 text-sm font-medium text-zinc-950 dark:text-white pt-2"
            >
              Pattern
            </Label>
            <div className="flex-1 flex flex-col gap-1">
              <Input
                id="pattern"
                value={pattern}
                onChange={(e) => setPattern(e.target.value)}
                placeholder="e.g., room:%, chat:lobby"
                className="dark:bg-neutral-900 dark:placeholder:text-neutral-500 dark:border-neutral-700 dark:text-white"
              />
              <p className="text-xs text-zinc-500 dark:text-neutral-400">
                Use alphanumeric characters, colons, hyphens, and % as wildcard
              </p>
            </div>
          </div>

          {/* Description */}
          <div className="flex flex-row justify-between gap-6">
            <Label
              htmlFor="description"
              className="w-28 shrink-0 text-sm font-medium text-zinc-950 dark:text-white pt-2"
            >
              Description
            </Label>
            <Textarea
              id="description"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Optional description for this channel"
              rows={2}
              className="flex-1 dark:bg-neutral-900 dark:placeholder:text-neutral-500 dark:border-neutral-700 dark:text-white resize-none"
            />
          </div>

          {/* Enabled Toggle */}
          <div className="flex flex-row justify-between gap-6">
            <Label
              htmlFor="enabled"
              className="w-28 shrink-0 text-sm font-medium text-zinc-950 dark:text-white"
            >
              Enabled
            </Label>
            <div className="flex-1">
              <Switch id="enabled" checked={enabled} onCheckedChange={setEnabled} />
            </div>
          </div>

          {/* Webhook URLs */}
          <div className="flex flex-row justify-between gap-6">
            <Label className="w-28 shrink-0 text-sm font-medium text-zinc-950 dark:text-white pt-2">
              Webhook URLs
            </Label>
            <div className="flex-1 flex flex-col gap-2">
              {webhookUrls.map((url, index) => (
                <div key={index} className="flex items-center gap-2">
                  <Input
                    value={url}
                    onChange={(e) => handleWebhookChange(index, e.target.value)}
                    placeholder="https://example.com/webhook"
                    className="flex-1 dark:bg-neutral-900 dark:placeholder:text-neutral-500 dark:border-neutral-700 dark:text-white"
                  />
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    onClick={() => handleRemoveWebhook(index)}
                    className="h-9 w-9 shrink-0 text-zinc-400 hover:text-red-500 dark:text-neutral-500 dark:hover:text-red-400"
                  >
                    <X className="h-4 w-4" />
                  </Button>
                </div>
              ))}
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={handleAddWebhook}
                className="w-fit h-8 px-2 text-sm text-zinc-600 hover:text-zinc-900 dark:text-neutral-400 dark:hover:text-white"
              >
                <Plus className="h-4 w-4 mr-1" />
                Add URL
              </Button>
              <p className="text-xs text-zinc-500 dark:text-neutral-400">
                Messages published to this channel will be forwarded to these URLs
              </p>
            </div>
          </div>
        </div>

        <DialogFooter className="px-6 py-4 gap-3 border-t border-zinc-200 dark:border-neutral-700">
          <Button
            type="button"
            variant="outline"
            onClick={() => onOpenChange(false)}
            disabled={isUpdating}
            className="h-9 px-4 dark:bg-neutral-600 dark:text-white dark:border-transparent dark:hover:bg-neutral-700"
          >
            Cancel
          </Button>
          <Button
            type="button"
            onClick={handleSave}
            disabled={!hasChanges() || isUpdating}
            className="h-9 px-4 bg-zinc-950 text-white hover:bg-zinc-800 disabled:opacity-40 dark:bg-emerald-300 dark:text-zinc-950 dark:hover:bg-emerald-400"
          >
            {isUpdating ? 'Saving...' : 'Save Changes'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
