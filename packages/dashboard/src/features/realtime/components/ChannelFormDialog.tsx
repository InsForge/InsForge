import { useEffect } from 'react';
import { Plus, X } from 'lucide-react';
import { useForm, useFieldArray, Controller } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import {
  Button,
  Dialog,
  DialogBody,
  DialogContent,
  DialogDivider,
  DialogFooter,
  DialogHeader,
  DialogDescription,
  DialogTitle,
  Input,
  Switch,
} from '@insforge/ui';
import { Label, Textarea } from '#components';
import { type CreateChannelRequest, type UpdateChannelRequest } from '@insforge/shared-schemas';
import type { RealtimeChannel } from '#features/realtime/services/realtime.service';

// ── Shared form state ──────────────────────────────────────────────────────────

interface FormValues {
  pattern: string;
  description: string;
  enabled: boolean;
  webhookUrls: { url: string }[];
}

const DEFAULT_VALUES: FormValues = {
  pattern: '',
  description: '',
  enabled: true,
  webhookUrls: [{ url: '' }],
};

const formSchema = z.object({
  pattern: z.string().min(1, 'Channel pattern is required'),
  description: z.string(),
  enabled: z.boolean(),
  webhookUrls: z.array(
    z.object({
      url: z.string().url('Invalid URL format').or(z.literal('')),
    })
  ),
});

// ── Props ──────────────────────────────────────────────────────────────────────

interface ChannelFormDialogProps {
  mode: 'create' | 'edit';
  channel?: RealtimeChannel | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSave?: (id: string, data: UpdateChannelRequest) => void;
  onCreate?: (data: CreateChannelRequest) => void;
  isUpdating?: boolean;
}

export function ChannelFormDialog({
  mode = 'edit',
  channel,
  open,
  onOpenChange,
  onSave,
  onCreate,
  isUpdating,
}: ChannelFormDialogProps) {
  const {
    register,
    handleSubmit,
    control,
    reset,
    formState: { errors, isDirty, isValid },
  } = useForm<FormValues>({
    resolver: zodResolver(formSchema),
    defaultValues: DEFAULT_VALUES,
    mode: 'onChange',
  });

  const { fields, append, remove } = useFieldArray({
    control,
    name: 'webhookUrls',
  });

  // Populate form when opening or channel changes
  useEffect(() => {
    if (!open) {
      return;
    }

    if (mode === 'create') {
      reset(DEFAULT_VALUES);
    } else if (channel) {
      reset({
        pattern: channel.pattern,
        description: channel.description || '',
        enabled: channel.enabled,
        webhookUrls:
          channel.webhookUrls && channel.webhookUrls.length > 0
            ? channel.webhookUrls.map((url) => ({ url }))
            : [{ url: '' }],
      });
    }
  }, [open, mode, channel, reset]);

  const onFormSubmit = (values: FormValues) => {
    // Filter out empty URLs for the API
    const webhookUrls = values.webhookUrls.map((w) => w.url.trim()).filter((url) => url.length > 0);

    if (mode === 'create') {
      const data: CreateChannelRequest = {
        pattern: values.pattern,
        enabled: values.enabled,
        description: values.description || undefined,
        webhookUrls: webhookUrls.length > 0 ? webhookUrls : undefined,
      };
      onCreate?.(data);
    } else if (channel) {
      const updates: UpdateChannelRequest = {};
      if (values.pattern !== channel.pattern) {
        updates.pattern = values.pattern;
      }
      if (values.description !== (channel.description || '')) {
        updates.description = values.description || undefined;
      }
      if (values.enabled !== channel.enabled) {
        updates.enabled = values.enabled;
      }

      const originalWebhooks = channel.webhookUrls || [];
      const webhooksChanged =
        webhookUrls.length !== originalWebhooks.length ||
        webhookUrls.some((url, i) => url !== originalWebhooks[i]);

      if (webhooksChanged) {
        updates.webhookUrls = webhookUrls;
      }

      onSave?.(channel.id, updates);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{mode === 'create' ? 'Add Channel' : 'Edit Channel'}</DialogTitle>
          <DialogDescription className="sr-only">
            {mode === 'create' ? 'Add a new channel' : 'Edit channel settings'}
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={(e) => void handleSubmit(onFormSubmit)(e)}>
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
                  {...register('pattern')}
                  placeholder="e.g., room:%, chat:lobby"
                  className={`h-8 rounded bg-[var(--alpha-4)] px-1.5 py-1.5 text-[13px] leading-[18px] ${
                    errors.pattern ? 'border-red-500 focus:ring-red-500' : ''
                  }`}
                />
                {errors.pattern && (
                  <p className="mt-1 text-xs text-red-500">{errors.pattern.message}</p>
                )}
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
                  {...register('description')}
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
                <Controller
                  name="enabled"
                  control={control}
                  render={({ field }) => (
                    <Switch
                      id="channel-enabled"
                      checked={field.value}
                      onCheckedChange={field.onChange}
                    />
                  )}
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
                {fields.map((field, index) => (
                  <div key={field.id} className="flex w-full flex-col gap-1">
                    <div className="flex w-full items-center gap-1.5">
                      <Input
                        {...register(`webhookUrls.${index}.url` as const)}
                        placeholder="https://example.com/webhook"
                        className={`h-8 flex-1 rounded bg-[var(--alpha-4)] px-1.5 py-1.5 text-[13px] leading-[18px] ${
                          errors.webhookUrls?.[index] ? 'border-red-500 focus:ring-red-500' : ''
                        }`}
                      />
                      {fields.length > 1 && (
                        <button
                          type="button"
                          onClick={() => remove(index)}
                          className="flex size-8 shrink-0 items-center justify-center rounded border border-[var(--alpha-8)] bg-card text-muted-foreground hover:text-foreground"
                        >
                          <X className="size-4" />
                        </button>
                      )}
                    </div>
                    {errors.webhookUrls?.[index]?.url && (
                      <p className="text-xs text-red-500">
                        {errors.webhookUrls[index].url.message}
                      </p>
                    )}
                  </div>
                ))}
                <button
                  type="button"
                  onClick={() => append({ url: '' })}
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
              type="submit"
              disabled={!isDirty || !isValid || isUpdating}
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
        </form>
      </DialogContent>
    </Dialog>
  );
}
