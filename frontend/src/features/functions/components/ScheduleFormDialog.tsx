import { useState, useEffect } from 'react';
import { useSchedules } from '@/features/functions/hooks/useSchedules';
import type { ScheduleFormSchema } from '../types';
import { useForm, Controller } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { createScheduleRequestSchema, type ScheduleSchema } from '@insforge/shared-schemas';
import {
  Button,
  Dialog,
  DialogBody,
  DialogContent,
  DialogDescription,
  DialogDivider,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  Input,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@insforge/ui';
import { Alert, AlertDescription } from '@/components/radix/Alert';
import { ScrollArea } from '@/components/radix/ScrollArea';
import { cn } from '@/lib/utils/utils';

interface InlineJsonEditorProps {
  value: string;
  nullable?: boolean;
  onChange: (v: string) => void;
  onCancel: () => void;
}

function InlineJsonEditor({ value, nullable, onChange, onCancel }: InlineJsonEditorProps) {
  const [text, setText] = useState(() => {
    if (!value || value === 'null') return '';
    try { return JSON.stringify(JSON.parse(value), null, 2); } catch { return value; }
  });
  const [isValid, setIsValid] = useState(true);

  const validate = (t: string) => {
    if (!t.trim()) { setIsValid(true); return true; }
    try { JSON.parse(t); setIsValid(true); return true; }
    catch { setIsValid(false); return false; }
  };

  const handleFormat = () => {
    try { setText(JSON.stringify(JSON.parse(text), null, 2)); setIsValid(true); } catch {}
  };

  const handleMinify = () => {
    try { setText(JSON.stringify(JSON.parse(text))); setIsValid(true); } catch {}
  };

  const handleSave = () => {
    if (!isValid) return;
    const t = text.trim();
    onChange(t ? JSON.stringify(JSON.parse(t)) : (nullable ? 'null' : '{}'));
    onCancel();
  };

  return (
    <div className="flex flex-col gap-2">
      <textarea
        value={text}
        onChange={(e) => { setText(e.target.value); validate(e.target.value); }}
        onKeyDown={(e) => {
          if (e.key === 'Tab') {
            e.preventDefault();
            const el = e.target as HTMLTextAreaElement;
            const s = el.selectionStart;
            const newVal = text.substring(0, s) + '  ' + text.substring(el.selectionEnd);
            setText(newVal);
            validate(newVal);
            setTimeout(() => { el.selectionStart = el.selectionEnd = s + 2; }, 0);
          } else if (e.key === 'Escape') { onCancel(); }
        }}
        placeholder="Enter JSON..."
        className={cn(
          'h-32 w-full resize-none rounded-lg border bg-[var(--alpha-4)] px-3 py-2 font-mono text-sm text-foreground placeholder:text-muted-foreground',
          'focus:outline-none focus:border-foreground/30',
          isValid ? 'border-[var(--alpha-12)]' : 'border-destructive'
        )}
        spellCheck={false}
        autoFocus
      />
      {!isValid && (
        <p className="text-[13px] leading-[18px] text-destructive">Invalid JSON</p>
      )}
      <div className="flex items-center justify-between">
        <div className="flex gap-1">
          <Button
            type="button" variant="ghost" size="sm"
            onClick={handleFormat}
            disabled={!isValid || !text.trim()}
            className="h-7 px-2 text-xs text-muted-foreground"
          >
            Format
          </Button>
          <Button
            type="button" variant="ghost" size="sm"
            onClick={handleMinify}
            disabled={!isValid || !text.trim()}
            className="h-7 px-2 text-xs text-muted-foreground"
          >
            Minify
          </Button>
        </div>
        <div className="flex gap-2">
          <Button type="button" variant="secondary" onClick={onCancel} className="h-7 px-3 text-xs">
            Cancel
          </Button>
          <Button type="button" onClick={handleSave} disabled={!isValid} className="h-7 px-3 text-xs">
            Save
          </Button>
        </div>
      </div>
    </div>
  );
}

interface ScheduleFormDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  mode?: 'create' | 'edit';
  scheduleId?: string | null;
  initialValues?: Partial<ScheduleFormSchema>;
  onSubmit?: (values: ScheduleFormSchema) => Promise<void> | void;
}

export function ScheduleFormDialog({
  open,
  onOpenChange,
  mode = 'create',
  scheduleId,
  initialValues,
  onSubmit,
}: ScheduleFormDialogProps) {
  const [error, setError] = useState<string | null>(null);
  const [editingField, setEditingField] = useState<'headers' | 'body' | null>(null);
  const [contentType, setContentType] = useState('application/json');

  const getJsonDisplay = (value: unknown): string => {
    if (value === null || value === undefined) {
      return 'null';
    }
    if (typeof value === 'string') {
      return value;
    }
    try {
      return JSON.stringify(value, null, 2);
    } catch {
      return String(value);
    }
  };

  const form = useForm<ScheduleFormSchema>({
    resolver: zodResolver(createScheduleRequestSchema),
    mode: 'onChange',
    reValidateMode: 'onChange',
    defaultValues: {
      name: initialValues?.name ?? '',
      cronSchedule: initialValues?.cronSchedule ?? '',
      functionUrl: initialValues?.functionUrl ?? '',
      httpMethod: initialValues?.httpMethod ?? 'POST',
      headers: initialValues?.headers ?? { 'Content-Type': 'application/json' },
      body: initialValues?.body ?? {},
    },
  });

  const { getSchedule } = useSchedules();
  const [scheduleData, setScheduleData] = useState<ScheduleSchema | null>(null);

  // Helper to extract Content-Type from headers
  const extractContentType = (headers: Record<string, string> | null | undefined): string => {
    if (!headers) {
      return 'application/json';
    }
    return headers['Content-Type'] || headers['content-type'] || 'application/json';
  };

  // Update headers when contentType changes
  const handleContentTypeChange = (newContentType: string) => {
    setContentType(newContentType);
    const currentHeaders = form.getValues('headers') ?? {};
    form.setValue('headers', { ...currentHeaders, 'Content-Type': newContentType });
  };

  useEffect(() => {
    if (!open) {
      setError(null);
      form.reset();
      setContentType('application/json');
      return;
    }

    if (mode === 'edit' && scheduleData) {
      const normalizedHeaders =
        scheduleData.headers === null
          ? { 'Content-Type': 'application/json' }
          : (scheduleData.headers as Record<string, string>);

      const normalizedBody =
        scheduleData.body === null
          ? {}
          : typeof scheduleData.body === 'string'
            ? (() => {
                try {
                  return JSON.parse(scheduleData.body) as Record<string, unknown>;
                } catch {
                  return {};
                }
              })()
            : (scheduleData.body as Record<string, unknown>);

      setContentType(extractContentType(normalizedHeaders));

      form.reset({
        name: scheduleData.name ?? '',
        cronSchedule: scheduleData.cronSchedule ?? '',
        functionUrl: scheduleData.functionUrl ?? '',
        httpMethod: scheduleData.httpMethod ?? 'POST',
        headers: normalizedHeaders,
        body: normalizedBody,
      });
    } else if (initialValues) {
      setContentType(extractContentType(initialValues.headers));

      form.reset({
        name: initialValues.name ?? '',
        cronSchedule: initialValues.cronSchedule ?? '',
        functionUrl: initialValues.functionUrl ?? '',
        httpMethod: initialValues.httpMethod ?? 'POST',
        headers: initialValues.headers ?? { 'Content-Type': 'application/json' },
        body: initialValues.body ?? {},
      });
    }
  }, [open, form, initialValues, mode, scheduleData]);

  useEffect(() => {
    if (!open || mode !== 'edit' || !scheduleId) {
      setScheduleData(null);
      return;
    }

    let mounted = true;
    void getSchedule(scheduleId)
      .then((s) => {
        if (mounted) {
          setScheduleData(s as ScheduleSchema | null);
        }
      })
      .catch((err) => {
        setError(err instanceof Error ? err.message : String(err));
      });

    return () => {
      mounted = false;
    };
  }, [open, mode, scheduleId, getSchedule]);

  const handleSubmit = form.handleSubmit(
    async (values) => {
      try {
        if (onSubmit) {
          await onSubmit(values as ScheduleFormSchema);
        }
        onOpenChange(false);
        form.reset();
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err));
      }
    },
    (errs) => {
      setError('Please review the form fields');
      console.error('validation', errs);
    }
  );

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-[520px]">
        <form onSubmit={(e) => void handleSubmit(e)} className="flex flex-col">
          <DialogHeader>
            <DialogTitle>{mode === 'create' ? 'Add Schedule' : 'Edit Schedule'}</DialogTitle>
            <DialogDescription>
              {mode === 'create'
                ? 'Configure a scheduled task to run your edge functions automatically.'
                : 'Update the schedule configuration.'}
            </DialogDescription>
          </DialogHeader>

          <ScrollArea className="h-full overflow-auto max-h-[600px]">
            <DialogBody className="gap-2 p-4">
              {/* Schedule Name */}
              <div className="flex w-full flex-col gap-1.5">
                <p className="text-sm font-medium leading-5 text-foreground">Schedule Name</p>
                <Input
                  {...form.register('name')}
                  placeholder="Enter schedule name"
                  className="h-8 px-1.5 py-1.5 text-sm leading-5"
                />
                {form.formState.errors.name && (
                  <p className="text-[13px] leading-[18px] text-destructive">
                    {form.formState.errors.name.message}
                  </p>
                )}
              </div>

              <DialogDivider />

              {/* Cron Schedule */}
              <div className="flex w-full flex-col gap-1.5">
                <div>
                  <p className="text-sm font-medium leading-5 text-foreground">Cron Schedule</p>
                  <p className="text-[13px] leading-[18px] text-muted-foreground">
                    Enter a cron expression or pick from examples
                  </p>
                </div>
                <div className="grid grid-cols-2 gap-1.5">
                  {[
                    { label: 'Every 5 minutes', value: '*/5 * * * *' },
                    { label: 'Every hour', value: '0 * * * *' },
                    { label: 'Every 1st of month', value: '0 0 1 * *' },
                    { label: 'Every Monday at 2 AM', value: '0 2 * * 1' },
                  ].map((preset) => (
                    <button
                      key={preset.value}
                      type="button"
                      className="rounded-lg border border-[var(--alpha-8)] bg-[var(--alpha-4)] px-3 py-2 text-left text-sm text-muted-foreground transition-colors hover:bg-[var(--alpha-8)]"
                      onClick={() =>
                        form.setValue('cronSchedule', preset.value, {
                          shouldDirty: true,
                          shouldValidate: true,
                        })
                      }
                    >
                      {preset.label}
                    </button>
                  ))}
                </div>
                <Input
                  {...form.register('cronSchedule')}
                  placeholder="e.g. */5 * * * *"
                  className="h-8 px-1.5 py-1.5 text-sm leading-5"
                />
                {form.formState.errors.cronSchedule && (
                  <p className="text-[13px] leading-[18px] text-destructive">
                    {form.formState.errors.cronSchedule.message}
                  </p>
                )}
              </div>

              <DialogDivider />

              {/* Function URL */}
              <div className="flex w-full flex-col gap-1.5">
                <p className="text-sm font-medium leading-5 text-foreground">Function URL</p>
                <Input
                  {...form.register('functionUrl')}
                  placeholder="https://..."
                  className="h-8 px-1.5 py-1.5 text-sm leading-5"
                />
                {form.formState.errors.functionUrl && (
                  <p className="text-[13px] leading-[18px] text-destructive">
                    {form.formState.errors.functionUrl.message}
                  </p>
                )}
              </div>

              <DialogDivider />

              {/* HTTP Method */}
              <div className="flex w-full items-center justify-between gap-6">
                <p className="text-sm font-medium leading-5 text-foreground">HTTP Method</p>
                <Controller
                  control={form.control}
                  name="httpMethod"
                  render={({ field }) => (
                    <Select value={field.value} onValueChange={field.onChange}>
                      <SelectTrigger className="w-[160px]">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="GET">GET</SelectItem>
                        <SelectItem value="POST">POST</SelectItem>
                        <SelectItem value="PUT">PUT</SelectItem>
                        <SelectItem value="PATCH">PATCH</SelectItem>
                        <SelectItem value="DELETE">DELETE</SelectItem>
                      </SelectContent>
                    </Select>
                  )}
                />
              </div>

              <DialogDivider />

              {/* Content Type */}
              <div className="flex w-full items-center justify-between gap-6">
                <p className="text-sm font-medium leading-5 text-foreground">Content Type</p>
                <Select value={contentType} onValueChange={handleContentTypeChange}>
                  <SelectTrigger className="w-[160px]">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="application/json">application/json</SelectItem>
                    <SelectItem value="text/plain">text/plain</SelectItem>
                    <SelectItem value="application/x-www-form-urlencoded">
                      application/x-www-form-urlencoded
                    </SelectItem>
                  </SelectContent>
                </Select>
              </div>

              <DialogDivider />

              {/* Headers (JSON) */}
              <div className="flex w-full flex-col gap-1.5">
                <p className="text-sm font-medium leading-5 text-foreground">Headers (JSON)</p>
                <Controller
                  control={form.control}
                  name="headers"
                  render={({ field }) => {
                    const inputValue =
                      field.value === null || field.value === undefined
                        ? 'null'
                        : typeof field.value === 'string'
                          ? field.value
                          : JSON.stringify(field.value, null, 2);
                    if (editingField === 'headers') {
                      return (
                        <InlineJsonEditor
                          value={inputValue}
                          nullable
                          onChange={(v) => {
                            try {
                              if (v === 'null') { field.onChange(null); }
                              else { field.onChange(JSON.parse(v)); }
                            } catch { /* InlineJsonEditor validates before calling onChange */ }
                          }}
                          onCancel={() => setEditingField(null)}
                        />
                      );
                    }
                    return (
                      <Button
                        type="button"
                        variant="secondary"
                        onClick={() => setEditingField('headers')}
                        className="h-8 w-full justify-start bg-[var(--alpha-4)] px-2 py-1.5 text-[13px] font-normal leading-[18px] text-muted-foreground"
                      >
                        <span className="truncate font-mono">
                          {inputValue.slice(0, 60)}{inputValue.length > 60 && '...'}
                        </span>
                      </Button>
                    );
                  }}
                />
              </div>

              <DialogDivider />

              {/* Body (JSON) */}
              <div className="flex w-full flex-col gap-1.5">
                <p className="text-sm font-medium leading-5 text-foreground">Body (JSON)</p>
                <Controller
                  control={form.control}
                  name="body"
                  render={({ field }) => {
                    const inputValue =
                      field.value === null || field.value === undefined
                        ? 'null'
                        : typeof field.value === 'string'
                          ? field.value
                          : JSON.stringify(field.value, null, 2);
                    if (editingField === 'body') {
                      return (
                        <InlineJsonEditor
                          value={inputValue}
                          nullable
                          onChange={(v) => {
                            try {
                              if (v === 'null') { field.onChange(null); }
                              else { field.onChange(JSON.parse(v)); }
                            } catch { /* InlineJsonEditor validates before calling onChange */ }
                          }}
                          onCancel={() => setEditingField(null)}
                        />
                      );
                    }
                    return (
                      <Button
                        type="button"
                        variant="secondary"
                        onClick={() => setEditingField('body')}
                        className="h-8 w-full justify-start bg-[var(--alpha-4)] px-2 py-1.5 text-[13px] font-normal leading-[18px] text-muted-foreground"
                      >
                        <span className="truncate font-mono">
                          {inputValue.slice(0, 60)}{inputValue.length > 60 && '...'}
                        </span>
                      </Button>
                    );
                  }}
                />
              </div>
            </DialogBody>
          </ScrollArea>

          {error && (
            <div className="shrink-0 px-4 py-3">
              <Alert variant="destructive">
                <AlertDescription>{error}</AlertDescription>
              </Alert>
            </div>
          )}

          <DialogFooter>
            <Button
              type="button"
              variant="secondary"
              onClick={() => onOpenChange(false)}
              className="w-30"
            >
              Cancel
            </Button>
            <Button
              type="submit"
              disabled={
                !form.formState.isValid ||
                form.formState.isSubmitting ||
                (mode === 'edit' && !form.formState.isDirty)
              }
              className="w-30"
            >
              {mode === 'create' ? 'Create' : 'Save'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
