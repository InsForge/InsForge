import { useState, useEffect } from 'react';
import { useSchedules } from '@/features/functions/hooks/useSchedules';
import type { ScheduleFormSchema } from '../types/schedules';
import { useForm, Controller } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { createScheduleRequestSchema, type ScheduleSchema } from '@insforge/shared-schemas';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@/components/radix/Dialog';
import { Button } from '@/components/radix/Button';
import { JsonCellEditor } from '@/components/datagrid/cell-editors/JsonCellEditor';
import { Switch } from '@/components/radix/Switch';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/radix/Select';
import { Alert, AlertDescription } from '@/components/radix/Alert';
import { ScrollArea } from '@/components/radix/ScrollArea';
import { Pencil } from 'lucide-react';

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
  const [advancedOpen, setAdvancedOpen] = useState(false);
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
      setAdvancedOpen(false);
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
      <DialogContent className="w-full max-w-xl p-0 gap-0 overflow-hidden flex flex-col">
        <form onSubmit={(e) => void handleSubmit(e)} className="flex flex-col">
          <DialogHeader className="px-6 py-4 border-b border-zinc-200 dark:border-neutral-700 bg-white dark:bg-neutral-900">
            <DialogTitle className="text-xl font-semibold text-zinc-950 dark:text-white">
              {mode === 'create' ? 'Create Schedule' : 'Edit Schedule'}
            </DialogTitle>
          </DialogHeader>

          <ScrollArea
            className={`h-full overflow-auto ${advancedOpen ? 'max-h-[680px]' : 'max-h-[520px]'}`}
          >
            <div className="px-6 py-6 space-y-8 bg-white dark:bg-neutral-900">
              <div className="grid gap-y-5 gap-x-6 md:grid-cols-[160px_minmax(0,1fr)] items-start">
                {/* Schedule Name */}
                <label className="text-sm font-medium text-zinc-700 dark:text-zinc-300 md:mt-2">
                  Schedule Name
                </label>
                <div>
                  <input
                    {...form.register('name')}
                    className="w-full px-3 py-2 rounded border bg-white dark:bg-neutral-800 border-zinc-200 dark:border-neutral-700 text-sm text-zinc-900 dark:text-zinc-100 placeholder-zinc-400 dark:placeholder-zinc-500"
                    placeholder="Enter schedule name"
                  />
                  {form.formState.errors.name && (
                    <p className="text-xs text-rose-500 mt-1">
                      {form.formState.errors.name.message}
                    </p>
                  )}
                </div>

                {/* Cron Schedule */}
                <div className="flex flex-col md:justify-start">
                  <label className="text-sm font-medium text-zinc-700 dark:text-zinc-300">
                    Cron Schedule
                  </label>
                  <span className="mt-2 text-xs text-zinc-500 dark:text-zinc-400">
                    Pick from examples
                  </span>
                </div>
                <div>
                  <input
                    {...form.register('cronSchedule')}
                    className="w-full px-3 py-2 rounded border bg-white dark:bg-neutral-800 border-zinc-200 dark:border-neutral-700 text-sm text-zinc-900 dark:text-zinc-100 placeholder-zinc-400 dark:placeholder-zinc-500"
                    placeholder="E.g., */5 * * * *"
                  />
                  <div className="mt-3 grid gap-2 sm:grid-cols-2">
                    <button
                      type="button"
                      className="px-3 py-2 rounded-lg bg-zinc-100 text-zinc-900 hover:bg-zinc-200 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-emerald-500 dark:bg-neutral-800 dark:text-zinc-100 dark:hover:bg-neutral-700 text-sm transition-colors text-left"
                      onClick={() => {
                        form.setValue('cronSchedule', '*/5 * * * *', {
                          shouldDirty: true,
                          shouldValidate: true,
                        });
                      }}
                    >
                      Every 5 minutes
                    </button>
                    <button
                      type="button"
                      className="px-3 py-2 rounded-lg bg-zinc-100 text-zinc-900 hover:bg-zinc-200 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-emerald-500 dark:bg-neutral-800 dark:text-zinc-100 dark:hover:bg-neutral-700 text-sm transition-colors text-left"
                      onClick={() => {
                        form.setValue('cronSchedule', '0 * * * *', {
                          shouldDirty: true,
                          shouldValidate: true,
                        });
                      }}
                    >
                      Every hour
                    </button>
                    <button
                      type="button"
                      className="px-3 py-2 rounded-lg bg-zinc-100 text-zinc-900 hover:bg-zinc-200 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-emerald-500 dark:bg-neutral-800 dark:text-zinc-100 dark:hover:bg-neutral-700 text-sm transition-colors text-left"
                      onClick={() => {
                        form.setValue('cronSchedule', '0 0 1 * *', {
                          shouldDirty: true,
                          shouldValidate: true,
                        });
                      }}
                    >
                      Every first of the month, at 00:00
                    </button>
                    <button
                      type="button"
                      className="px-3 py-2 rounded-lg bg-zinc-100 text-zinc-900 hover:bg-zinc-200 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-emerald-500 dark:bg-neutral-800 dark:text-zinc-100 dark:hover:bg-neutral-700 text-sm transition-colors text-left"
                      onClick={() => {
                        form.setValue('cronSchedule', '0 2 * * 1', {
                          shouldDirty: true,
                          shouldValidate: true,
                        });
                      }}
                    >
                      Every Monday at 2 AM
                    </button>
                  </div>
                  {form.formState.errors.cronSchedule && (
                    <p className="text-xs text-rose-500 mt-2">
                      {form.formState.errors.cronSchedule.message}
                    </p>
                  )}
                </div>

                {/* Function URL */}
                <label className="text-sm font-medium text-zinc-700 dark:text-zinc-300 md:mt-2">
                  Function URL
                </label>
                <div>
                  <input
                    {...form.register('functionUrl')}
                    className="w-full px-3 py-2 rounded border bg-white dark:bg-neutral-800 border-zinc-200 dark:border-neutral-700 text-sm text-zinc-900 dark:text-zinc-100 placeholder-zinc-400 dark:placeholder-zinc-500"
                    placeholder="Enter Function URL"
                  />
                  {form.formState.errors.functionUrl && (
                    <p className="text-xs text-rose-500 mt-1">
                      {form.formState.errors.functionUrl.message}
                    </p>
                  )}
                </div>

                {/* HTTP Method */}
                <label className="text-sm font-medium text-zinc-700 dark:text-zinc-300 md:mt-2">
                  HTTP Method
                </label>
                <Controller
                  control={form.control}
                  name="httpMethod"
                  render={({ field }) => (
                    <Select value={field.value} onValueChange={field.onChange}>
                      <SelectTrigger className="w-full">
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

                {/* Content Type */}
                <label className="text-sm font-medium text-zinc-700 dark:text-zinc-300 md:mt-2">
                  Content Type
                </label>
                <Select value={contentType} onValueChange={handleContentTypeChange}>
                  <SelectTrigger className="w-full">
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

              {/* Advanced options toggle - following same grid layout */}
              <div className="grid gap-y-5 gap-x-6 md:grid-cols-[160px_minmax(0,1fr)] items-center">
                <label className="text-sm font-medium text-zinc-700 dark:text-zinc-300">
                  Advanced options
                </label>
                <Switch checked={advancedOpen} onCheckedChange={(val) => setAdvancedOpen(val)} />
              </div>

              {advancedOpen && (
                <div className="grid gap-y-5 gap-x-6 md:grid-cols-[160px_minmax(0,1fr)] items-start">
                  {/* Headers (JSON) */}
                  <label className="text-sm font-medium text-zinc-700 dark:text-zinc-300 md:mt-2">
                    Headers (JSON)
                  </label>
                  <div className="space-y-2">
                    <div className="flex items-center gap-2">
                      <div className="flex-1 px-3 py-2 rounded-lg border bg-zinc-50 dark:bg-neutral-800/50 border-zinc-200 dark:border-neutral-700 text-sm text-zinc-600 dark:text-zinc-400 font-mono truncate">
                        {getJsonDisplay(form.watch('headers')).slice(0, 50)}
                        {getJsonDisplay(form.watch('headers')).length > 50 && '...'}
                      </div>
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        onClick={() =>
                          setEditingField(editingField === 'headers' ? null : 'headers')
                        }
                        className="shrink-0 dark:text-zinc-100"
                      >
                        <Pencil className="h-3.5 w-3.5" /> Edit
                      </Button>
                    </div>
                    {editingField === 'headers' && (
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

                          return (
                            <JsonCellEditor
                              value={inputValue}
                              nullable
                              onValueChange={(v) => {
                                if (v === 'null') {
                                  field.onChange(null);
                                  return;
                                }
                                try {
                                  const parsed = JSON.parse(v);
                                  field.onChange(parsed);
                                } catch {
                                  field.onChange(v);
                                }
                              }}
                              onCancel={() => setEditingField(null)}
                              className="w-full"
                            />
                          );
                        }}
                      />
                    )}
                  </div>

                  {/* Body (JSON) */}
                  <label className="text-sm font-medium text-zinc-700 dark:text-zinc-300 md:mt-2">
                    Body (JSON)
                  </label>
                  <div className="space-y-2">
                    <div className="flex items-center gap-2">
                      <div className="flex-1 px-3 py-2 rounded-lg border bg-zinc-50 dark:bg-neutral-800/50 border-zinc-200 dark:border-neutral-700 text-sm text-zinc-600 dark:text-zinc-400 font-mono truncate">
                        {getJsonDisplay(form.watch('body')).slice(0, 50)}
                        {getJsonDisplay(form.watch('body')).length > 50 && '...'}
                      </div>
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        onClick={() => setEditingField(editingField === 'body' ? null : 'body')}
                        className="shrink-0 dark:text-zinc-100"
                      >
                        <Pencil className="h-3.5 w-3.5 dark:text-zinc-100" /> Edit
                      </Button>
                    </div>
                    {editingField === 'body' && (
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

                          return (
                            <JsonCellEditor
                              value={inputValue}
                              nullable
                              onValueChange={(v) => {
                                if (v === 'null') {
                                  field.onChange(null);
                                  return;
                                }
                                try {
                                  const parsed = JSON.parse(v);
                                  field.onChange(parsed);
                                } catch {
                                  field.onChange(v);
                                }
                              }}
                              onCancel={() => setEditingField(null)}
                              className="w-full"
                            />
                          );
                        }}
                      />
                    )}
                  </div>
                </div>
              )}
            </div>
          </ScrollArea>

          {error && (
            <div className="px-6 py-3 shrink-0">
              <Alert variant="destructive">
                <AlertDescription>{error}</AlertDescription>
              </Alert>
            </div>
          )}

          <DialogFooter className="px-6 py-4 gap-3 sm:justify-end border-t border-zinc-200 dark:border-neutral-700 shrink-0 bg-white dark:bg-neutral-900">
            <Button
              type="button"
              variant="outline"
              onClick={() => onOpenChange(false)}
              className="h-10 px-5 dark:bg-neutral-600 dark:text-zinc-300 dark:border-neutral-600 dark:hover:bg-neutral-700"
            >
              Cancel
            </Button>
            <Button
              type="submit"
              className="h-10 px-5 font-medium bg-zinc-950 text-white hover:bg-zinc-800 dark:bg-emerald-300 dark:text-zinc-950 dark:hover:bg-emerald-400 disabled:opacity-40"
              disabled={!form.formState.isValid || form.formState.isSubmitting}
            >
              {mode === 'create' ? 'Create' : 'Save'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
