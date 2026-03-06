import { useState, useEffect } from 'react';
import { Plus, X } from 'lucide-react';
import {
  Button,
  Dialog,
  DialogBody,
  DialogContent,
  DialogDivider,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  Input,
  Switch,
} from '@insforge/ui';
import { Label, Textarea } from '@/components';
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
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Edit Channel</DialogTitle>
        </DialogHeader>

        <DialogBody>
          {/* Pattern */}
          <div className="flex gap-6 items-start">
            <div className="flex w-[200px] shrink-0 flex-col gap-2">
              <Label htmlFor="pattern" className="leading-5 text-foreground">
                Pattern
              </Label>
              <p className="pb-2 text-[13px] leading-[18px] text-muted-foreground">
                Use alphanumeric characters, colons, hyphens, and % as wildcard
              </p>
            </div>
            <div className="min-w-0 flex-1">
              <Input
                id="pattern"
                value={pattern}
                onChange={(e) => setPattern(e.target.value)}
                placeholder="e.g., room:%, chat:lobby"
                className="h-8 rounded bg-[var(--alpha-4)] px-1.5 py-1.5 text-[13px] leading-[18px]"
              />
            </div>
          </div>

          <DialogDivider />

          {/* Description */}
          <div className="flex gap-6 items-start">
            <div className="w-[200px] shrink-0">
              <Label htmlFor="description" className="leading-5 text-foreground">
                Description
              </Label>
            </div>
            <div className="min-w-0 flex-1">
              <Textarea
                id="description"
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder="Enter your message here"
                rows={3}
                className="min-h-[80px] rounded bg-[var(--alpha-4)] border-[var(--alpha-12)] text-foreground px-2.5 py-1.5 text-[13px] leading-[18px] resize-none"
              />
            </div>
          </div>

          <DialogDivider />

          {/* Enabled */}
          <div className="flex gap-6 items-center">
            <div className="w-[200px] shrink-0">
              <Label htmlFor="enabled" className="leading-5 text-foreground">
                Enabled
              </Label>
            </div>
            <div className="min-w-0 flex-1 flex justify-end">
              <Switch id="enabled" checked={enabled} onCheckedChange={setEnabled} />
            </div>
          </div>

          <DialogDivider />

          {/* Webhook URLs */}
          <div className="flex gap-6 items-start">
            <div className="flex w-[200px] shrink-0 flex-col gap-2">
              <Label className="leading-5 text-foreground">Webhook URLs</Label>
              <p className="pb-2 text-[13px] leading-[18px] text-muted-foreground">
                Messages published to this channel will be forwarded to these URLs
              </p>
            </div>
            <div className="min-w-0 flex-1 flex flex-col gap-2 items-end">
              {webhookUrls.map((url, index) => (
                <div key={index} className="flex w-full items-center gap-1.5">
                  <Input
                    value={url}
                    onChange={(e) => handleWebhookChange(index, e.target.value)}
                    placeholder="https://example.com/webhook"
                    className="h-8 flex-1 rounded bg-[var(--alpha-4)] px-1.5 py-1.5 text-[13px] leading-[18px]"
                  />
                  {index > 0 && (
                    <button
                      type="button"
                      onClick={() => handleRemoveWebhook(index)}
                      className="flex size-8 shrink-0 items-center justify-center rounded border border-[var(--alpha-8)] bg-card text-muted-foreground hover:text-foreground"
                    >
                      <X className="size-4" />
                    </button>
                  )}
                </div>
              ))}
              <button
                type="button"
                onClick={handleAddWebhook}
                className="flex h-8 items-center gap-0.5 rounded border border-[var(--alpha-8)] bg-card px-1.5 text-sm font-medium text-foreground"
              >
                <Plus className="size-5" />
                <span className="px-1">Add URL</span>
              </button>
            </div>
          </div>
        </DialogBody>

        <DialogFooter>
          <Button
            type="button"
            variant="secondary"
            onClick={() => onOpenChange(false)}
            disabled={isUpdating}
            className="h-8 rounded px-2"
          >
            Cancel
          </Button>
          <Button
            type="button"
            onClick={handleSave}
            disabled={!hasChanges() || isUpdating}
            className="h-8 rounded px-2"
          >
            {isUpdating ? 'Saving...' : 'Save Changes'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
