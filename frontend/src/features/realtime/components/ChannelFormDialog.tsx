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
import type { CreateChannelRequest, UpdateChannelRequest } from '@insforge/shared-schemas';

// ── Shared form state ──────────────────────────────────────────────────────────

interface FormState {
  pattern: string;
  description: string;
  enabled: boolean;
  webhookUrls: string[];
}

const DEFAULT_FORM: FormState = {
  pattern: '',
  description: '',
  enabled: true,
  webhookUrls: [''],
};

// ── Props ──────────────────────────────────────────────────────────────────────

type CreateProps = {
  mode: 'create';
  channel?: never;
  onSave?: never;
  onCreate: (data: CreateChannelRequest) => void;
  isUpdating?: boolean;
};

type EditProps = {
  mode?: 'edit';
  channel: RealtimeChannel | null;
  onSave: (id: string, data: UpdateChannelRequest) => void;
  onCreate?: never;
  isUpdating?: boolean;
};

type ChannelFormDialogProps = (CreateProps | EditProps) & {
  open: boolean;
  onOpenChange: (open: boolean) => void;
};

export function ChannelFormDialog({
  mode = 'edit',
  channel,
  open,
  onOpenChange,
  onSave,
  onCreate,
  isUpdating,
}: ChannelFormDialogProps) {
  const [form, setForm] = useState<FormState>(DEFAULT_FORM);

  // Populate form when opening
  useEffect(() => {
    if (!open) {
      return;
    }

    if (mode === 'create') {
      setForm(DEFAULT_FORM);
    } else if (channel) {
      setForm({
        pattern: channel.pattern,
        description: channel.description || '',
        enabled: channel.enabled,
        webhookUrls:
          channel.webhookUrls && channel.webhookUrls.length > 0 ? channel.webhookUrls : [''],
      });
    }
  }, [open, mode, channel]);

  // ── Webhook helpers ────────────────────────────────────────────────────────

  const handleAddWebhook = () => {
    setForm((f) => ({ ...f, webhookUrls: [...f.webhookUrls, ''] }));
  };

  const handleRemoveWebhook = (index: number) => {
    setForm((f) => ({
      ...f,
      webhookUrls: f.webhookUrls.length === 1 ? [''] : f.webhookUrls.filter((_, i) => i !== index),
    }));
  };

  const handleWebhookChange = (index: number, value: string) => {
    setForm((f) => {
      const updated = [...f.webhookUrls];
      updated[index] = value;
      return { ...f, webhookUrls: updated };
    });
  };

  const filteredWebhooks = form.webhookUrls.filter((url) => url.trim() !== '');

  const handleSave = () => {
    if (mode === 'create') {
      const data: CreateChannelRequest = {
        pattern: form.pattern,
        enabled: form.enabled,
      };
      if (form.description) {
        data.description = form.description;
      }
      if (filteredWebhooks.length > 0) {
        data.webhookUrls = filteredWebhooks;
      }
      onCreate?.(data);
      return;
    }

    if (!channel) {
      return;
    }

    const updates: UpdateChannelRequest = {};

    if (form.pattern !== channel.pattern) {
      updates.pattern = form.pattern;
    }
    if (form.description !== (channel.description || '')) {
      updates.description = form.description || undefined;
    }
    if (form.enabled !== channel.enabled) {
      updates.enabled = form.enabled;
    }

    const originalWebhooks = channel.webhookUrls || [];
    const webhooksChanged =
      filteredWebhooks.length !== originalWebhooks.length ||
      filteredWebhooks.some((url, i) => url !== originalWebhooks[i]);
    if (webhooksChanged) {
      updates.webhookUrls = filteredWebhooks;
    }

    onSave?.(channel.id, updates);
  };

  const canSave = () => {
    if (mode === 'create') {
      return form.pattern.trim().length > 0;
    }

    if (!channel) {
      return false;
    }
    const originalWebhooks = channel.webhookUrls || [];
    const webhooksChanged =
      filteredWebhooks.length !== originalWebhooks.length ||
      filteredWebhooks.some((url, i) => url !== originalWebhooks[i]);
    return (
      form.pattern !== channel.pattern ||
      form.description !== (channel.description || '') ||
      form.enabled !== channel.enabled ||
      webhooksChanged
    );
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{mode === 'create' ? 'Add Channel' : 'Edit Channel'}</DialogTitle>
        </DialogHeader>

        <DialogBody>
          {/* Pattern */}
          <div className="flex gap-6 items-start">
            <div className="flex w-[200px] shrink-0 flex-col gap-2">
              <Label htmlFor="channel-pattern" className="leading-5 text-foreground">
                Pattern
              </Label>
              <p className="pb-2 text-[13px] leading-[18px] text-muted-foreground">
                Use alphanumeric characters, colons, hyphens, and % as wildcard
              </p>
            </div>
            <div className="min-w-0 flex-1">
              <Input
                id="channel-pattern"
                value={form.pattern}
                onChange={(e) => setForm((f) => ({ ...f, pattern: e.target.value }))}
                placeholder="e.g., room:%, chat:lobby"
                className="h-8 rounded bg-[var(--alpha-4)] px-1.5 py-1.5 text-[13px] leading-[18px]"
              />
            </div>
          </div>

          <DialogDivider />

          <div className="flex gap-6 items-start">
            <div className="w-[200px] shrink-0">
              <Label htmlFor="channel-description" className="leading-5 text-foreground">
                Description
              </Label>
            </div>
            <div className="min-w-0 flex-1">
              <Textarea
                id="channel-description"
                value={form.description}
                onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))}
                placeholder="Optional description"
                rows={3}
                className="min-h-[80px] rounded bg-[var(--alpha-4)] border-[var(--alpha-12)] text-foreground px-2.5 py-1.5 text-[13px] leading-[18px] resize-none"
              />
            </div>
          </div>

          <DialogDivider />

          <div className="flex gap-6 items-center">
            <div className="w-[200px] shrink-0">
              <Label htmlFor="channel-enabled" className="leading-5 text-foreground">
                Enabled
              </Label>
            </div>
            <div className="min-w-0 flex-1 flex justify-end">
              <Switch
                id="channel-enabled"
                checked={form.enabled}
                onCheckedChange={(v) => setForm((f) => ({ ...f, enabled: v }))}
              />
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
              {form.webhookUrls.map((url, index) => (
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
            disabled={!canSave() || isUpdating}
            className="h-8 rounded px-2"
          >
            {isUpdating
              ? mode === 'create'
                ? 'Creating...'
                : 'Saving...'
              : mode === 'create'
                ? 'Create Channel'
                : 'Save Changes'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
