import { useState, useEffect } from 'react';
import { useSchedules } from '@/features/schedules/hooks/useSchedules';
import type { ScheduleRow } from '../types/schedules';
import { useForm, Controller } from 'react-hook-form';
import { z } from 'zod';
import { zodResolver } from '@hookform/resolvers/zod';
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
import { Alert, AlertDescription } from '@/components/radix/Alert';
import { ScrollArea } from '@/components/radix/ScrollArea';
import { cn } from '@/lib/utils/utils';
import { ChevronDown, Pencil } from 'lucide-react';

const createCronJobSchema = z.object({
  name: z.string().min(1, 'Job name is required'),
  cronSchedule: z.string().min(1, 'Cron schedule is required'),
  functionUrl: z.string().url('Must be a valid URL'),
  httpMethod: z.enum(['GET', 'POST', 'PUT', 'PATCH', 'DELETE']).optional(),
  contentType: z
    .enum(['application/json', 'text/plain', 'application/x-www-form-urlencoded'])
    .optional(),
  headers: z
    .union([z.string(), z.record(z.unknown())])
    .nullable()
    .optional(),
  body: z
    .union([z.string(), z.record(z.unknown())])
    .nullable()
    .optional(),
});

export type CronJobForm = z.infer<typeof createCronJobSchema>;

interface CronJobFormDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  mode?: 'create' | 'edit';
  scheduleId?: string | null;
  initialValues?: Partial<CronJobForm>;
  onSubmit?: (values: CronJobForm) => Promise<void> | void;
}

export function CronJobFormDialog({
  open,
  onOpenChange,
  mode = 'create',
  scheduleId,
  initialValues,
  onSubmit,
}: CronJobFormDialogProps) {
  const [error, setError] = useState<string | null>(null);
  const [advancedOpen, setAdvancedOpen] = useState(false);
  const [editingField, setEditingField] = useState<'headers' | 'body' | null>(null);

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

  const form = useForm<CronJobForm>({
    resolver: zodResolver(createCronJobSchema),
    mode: 'onChange',
    reValidateMode: 'onChange',
    defaultValues: {
      name: initialValues?.name ?? '',
      cronSchedule: initialValues?.cronSchedule ?? '',
      functionUrl: initialValues?.functionUrl ?? '',
      httpMethod: initialValues?.httpMethod ?? 'POST',
      contentType: initialValues?.contentType ?? 'application/json',
      headers: initialValues?.headers ?? { 'Content-Type': 'application/json' },
      body: initialValues?.body ?? {},
    },
  });

  const { getSchedule } = useSchedules();
  const [scheduleData, setScheduleData] = useState<ScheduleRow | null>(null);

  useEffect(() => {
    if (!open) {
      setError(null);
      form.reset();
      setAdvancedOpen(false);
      return;
    }

    if (mode === 'edit' && scheduleData) {
      const normalizedHeaders =
        scheduleData.headers === null
          ? { 'Content-Type': 'application/json' }
          : typeof scheduleData.headers === 'string'
            ? scheduleData.headers
            : (scheduleData.headers as unknown as Record<string, unknown>);

      const normalizedBody =
        scheduleData.body === null
          ? {}
          : typeof scheduleData.body === 'string'
            ? scheduleData.body
            : (scheduleData.body as unknown as Record<string, unknown>);

      form.reset({
        name: scheduleData.name ?? '',
        cronSchedule: scheduleData.cronSchedule ?? '',
        functionUrl: scheduleData.functionUrl ?? '',
        httpMethod: scheduleData.httpMethod ?? 'POST',
        contentType: 'application/json',
        headers: normalizedHeaders,
        body: normalizedBody,
      });
    } else if (initialValues) {
      form.reset({
        name: initialValues.name ?? '',
        cronSchedule: initialValues.cronSchedule ?? '',
        functionUrl: initialValues.functionUrl ?? '',
        httpMethod: initialValues.httpMethod ?? 'POST',
        contentType: initialValues.contentType ?? 'application/json',
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
          setScheduleData(s as ScheduleRow | null);
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
          await onSubmit(values as CronJobForm);
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
              {mode === 'create' ? 'Create a Cron Job' : 'Edit Cron Job'}
            </DialogTitle>
          </DialogHeader>

          <ScrollArea className="h-full max-h-[520px] overflow-auto">
            <div className="px-6 py-6 space-y-8 bg-white dark:bg-neutral-900">
              <div className="grid gap-y-5 gap-x-6 md:grid-cols-[160px_minmax(0,1fr)] items-start">
                {/* Job Name */}
                <label className="text-sm font-medium text-zinc-700 dark:text-zinc-300 md:text-right md:mt-2">
                  Job Name<span className="ml-1 text-rose-600">*</span>
                </label>
                <div>
                  <input
                    {...form.register('name')}
                    className="w-full px-3 py-2 rounded border bg-white dark:bg-neutral-800 border-zinc-200 dark:border-neutral-700 text-sm text-zinc-900 dark:text-zinc-100 placeholder-zinc-400 dark:placeholder-zinc-500"
                    placeholder="Enter the job name"
                  />
                  {form.formState.errors.name && (
                    <p className="text-xs text-rose-500 mt-1">
                      {form.formState.errors.name.message}
                    </p>
                  )}
                </div>

                {/* Cron Schedule */}
                <div className="flex flex-col md:items-end md:justify-start md:text-right">
                  <label className="text-sm font-medium text-zinc-700 dark:text-zinc-300">
                    Cron Schedule<span className="ml-1 text-rose-600">*</span>
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
                <label className="text-sm font-medium text-zinc-700 dark:text-zinc-300 md:text-right md:mt-2">
                  Function URL<span className="ml-1 text-rose-600">*</span>
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
                <label className="text-sm font-medium text-zinc-700 dark:text-zinc-300 md:text-right md:mt-2">
                  HTTP Method
                </label>
                <div className="relative">
                  <select
                    {...form.register('httpMethod')}
                    className="w-full px-3 py-2 rounded-md border bg-white dark:bg-neutral-800 border-zinc-200 dark:border-neutral-700 text-sm text-zinc-900 dark:text-zinc-100 appearance-none pr-10"
                  >
                    <option value="">Select http method</option>
                    <option value="GET">GET</option>
                    <option value="POST">POST</option>
                    <option value="PUT">PUT</option>
                    <option value="PATCH">PATCH</option>
                    <option value="DELETE">DELETE</option>
                  </select>
                  <ChevronDown className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 h-4 w-4 text-zinc-400" />
                </div>

                {/* Content Type */}
                <label className="text-sm font-medium text-zinc-700 dark:text-zinc-300 md:text-right md:mt-2">
                  Content Type
                </label>
                <div className="relative">
                  <select
                    {...form.register('contentType')}
                    className="w-full px-3 py-2 rounded-md border bg-white dark:bg-neutral-800 border-zinc-200 dark:border-neutral-700 text-sm text-zinc-900 dark:text-zinc-100 appearance-none pr-10"
                  >
                    <option value="">Select content type</option>
                    <option value="application/json">application/json</option>
                    <option value="text/plain">text/plain</option>
                    <option value="application/x-www-form-urlencoded">
                      application/x-www-form-urlencoded
                    </option>
                  </select>
                  <ChevronDown className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 h-4 w-4 text-zinc-400" />
                </div>
              </div>

              {/* Advanced options toggle - following same grid layout */}
              <div className="grid gap-y-5 gap-x-6 md:grid-cols-[160px_minmax(0,1fr)] items-start">
                <label className="text-sm font-medium text-zinc-700 dark:text-zinc-300 md:text-right md:mt-2">
                  Advanced options
                </label>
                <div>
                  <Switch checked={advancedOpen} onCheckedChange={(val) => setAdvancedOpen(val)} />
                </div>
              </div>

              {advancedOpen && (
                <div className="grid gap-y-5 gap-x-6 md:grid-cols-[160px_minmax(0,1fr)] items-start">
                  {/* Headers (JSON) */}
                  <label className="text-sm font-medium text-zinc-700 dark:text-zinc-300 md:text-right md:mt-2">
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
                  <label className="text-sm font-medium text-zinc-700 dark:text-zinc-300 md:text-right md:mt-2">
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
              className="h-10 px-5 bg-zinc-800 text-white hover:bg-zinc-700 dark:bg-neutral-700 dark:text-zinc-100 dark:border-neutral-600 dark:hover:bg-neutral-600"
            >
              Cancel
            </Button>
            <Button
              type="submit"
              className={cn(
                'h-10 px-5 font-medium bg-emerald-500 text-white hover:bg-emerald-600 dark:bg-emerald-300 dark:text-black dark:hover:bg-emerald-400 rounded-md transition-colors disabled:opacity-60 disabled:cursor-not-allowed'
              )}
              disabled={!form.formState.isValid}
            >
              {mode === 'create' ? 'Create' : 'Save'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
