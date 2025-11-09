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

const createCronJobSchema = z.object({
  name: z.string().min(1, 'Job name is required'),
  cronSchedule: z.string().min(1, 'Cron schedule is required'),
  functionUrl: z.string().url('Must be a valid URL'),
  httpMethod: z.enum(['GET', 'POST', 'PUT', 'PATCH', 'DELETE']).optional(),
  contentType: z
    .enum(['application/json', 'text/plain', 'application/x-www-form-urlencoded'])
    .optional(),
  // JsonCellEditor provides a stringified JSON value; store either the raw string or a parsed object.
  headers: z
    .union([z.string(), z.record(z.unknown())])
    .nullable()
    .optional(),
  body: z
    .union([z.string(), z.record(z.unknown())])
    .nullable()
    .optional(),
});

type CronJobForm = z.infer<typeof createCronJobSchema>;

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

  const form = useForm<CronJobForm>({
    resolver: zodResolver(createCronJobSchema),
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

  // useSchedules returns helper methods including getSchedule
  const { getSchedule } = useSchedules();
  const [scheduleData, setScheduleData] = useState<ScheduleRow | null>(null);

  useEffect(() => {
    if (!open) {
      setError(null);
      form.reset();
      setAdvancedOpen(false);
      return;
    }

    // If editing and scheduleData is available, prefer it for initial form values
    if (mode === 'edit' && scheduleData) {
      // Normalize headers/body which might be stringified JSON or objects coming from the API
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

  // Fetch schedule details when editing
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
        // surface the error in the form
        setError(err instanceof Error ? err.message : String(err));
      });

    return () => {
      mounted = false;
    };
  }, [open, mode, scheduleId, getSchedule]);

  const handleSubmit = form.handleSubmit(
    async (values) => {
      try {
        // JsonCellEditor will provide normalized JSON values; no additional parsing required here.
        // We accept whatever the editor provides (stringified JSON or parsed object) and pass it through to onSubmit.

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
      <DialogContent className="max-w-160 p-0 gap-0 overflow-hidden flex flex-col">
        <form onSubmit={(e) => void handleSubmit(e)} className="flex flex-col">
          <DialogHeader className="px-4 py-3 border-b border-zinc-200 dark:border-neutral-700">
            <DialogTitle className="text-lg font-semibold text-zinc-950 dark:text-white">
              {mode === 'create' ? 'Create a Cron Job' : 'Edit Cron Job'}
            </DialogTitle>
          </DialogHeader>

          <ScrollArea className="h-full max-h-[420px] overflow-auto">
            <div className="p-4">
              <div className="grid grid-cols-12 gap-3 items-start">
                <div className="col-span-3 text-sm text-zinc-700 dark:text-zinc-300 pt-1">
                  Job Name<span className="ml-1 text-rose-600 dark:text-rose-400">*</span>
                </div>
                <div className="col-span-9">
                  <input
                    {...form.register('name')}
                    className="w-full max-w-sm px-3 py-2 rounded border bg-white dark:bg-neutral-700 border-zinc-200 dark:border-neutral-600 text-sm text-zinc-900 dark:text-zinc-100"
                    placeholder="Enter the job name"
                  />
                </div>

                <div className="col-span-3 text-sm text-zinc-700 dark:text-zinc-300">
                  <div className="pt-1">
                    Cron Schedule<span className="ml-1 text-rose-600 dark:text-rose-400">*</span>
                  </div>
                  <div className="text-xs text-zinc-500 dark:text-zinc-400 mt-1 whitespace-nowrap">
                    Pick from examples
                  </div>
                </div>
                <div className="col-span-9">
                  <input
                    {...form.register('cronSchedule')}
                    className="w-full max-w-sm px-2 py-1.5 rounded border bg-white dark:bg-neutral-700 border-zinc-200 dark:border-neutral-600 text-sm text-zinc-900 dark:text-zinc-100"
                    placeholder="E.g., */5 * * * *"
                  />
                  <div className="mt-2 flex flex-wrap gap-2">
                    <button
                      type="button"
                      className="px-3 py-1.5 rounded bg-zinc-100 text-zinc-900 hover:bg-zinc-200 focus:outline-none focus:ring-2 focus:ring-emerald-300 dark:bg-neutral-600 dark:text-zinc-100 dark:hover:bg-neutral-500 text-sm shadow-sm"
                      onClick={() => {
                        form.setValue('cronSchedule', '*/5 * * * *', {
                          shouldDirty: true,
                          shouldValidate: true,
                        });
                        form.setFocus('cronSchedule');
                      }}
                    >
                      Every 5 minutes
                    </button>
                    <button
                      type="button"
                      className="px-3 py-1.5 rounded bg-zinc-100 text-zinc-900 hover:bg-zinc-200 focus:outline-none focus:ring-2 focus:ring-emerald-300 dark:bg-neutral-600 dark:text-zinc-100 dark:hover:bg-neutral-500 text-sm shadow-sm"
                      onClick={() => {
                        form.setValue('cronSchedule', '0 * * * *', {
                          shouldDirty: true,
                          shouldValidate: true,
                        });
                        form.setFocus('cronSchedule');
                      }}
                    >
                      Every hour
                    </button>
                    <button
                      type="button"
                      className="px-3 py-1.5 rounded bg-zinc-100 text-zinc-900 hover:bg-zinc-200 focus:outline-none focus:ring-2 focus:ring-emerald-300 dark:bg-neutral-600 dark:text-zinc-100 dark:hover:bg-neutral-500 text-sm shadow-sm"
                      onClick={() => {
                        form.setValue('cronSchedule', '0 0 1 * *', {
                          shouldDirty: true,
                          shouldValidate: true,
                        });
                        form.setFocus('cronSchedule');
                      }}
                    >
                      Every first of the month at 00:00
                    </button>
                    <button
                      type="button"
                      className="px-3 py-1.5 rounded bg-zinc-100 text-zinc-900 hover:bg-zinc-200 focus:outline-none focus:ring-2 focus:ring-emerald-300 dark:bg-neutral-600 dark:text-zinc-100 dark:hover:bg-neutral-500 text-sm shadow-sm"
                      onClick={() => {
                        form.setValue('cronSchedule', '0 2 * * 1', {
                          shouldDirty: true,
                          shouldValidate: true,
                        });
                        form.setFocus('cronSchedule');
                      }}
                    >
                      Every Monday at 2:00 AM
                    </button>
                  </div>
                </div>

                <div className="col-span-3 text-sm text-zinc-700 dark:text-zinc-300 pt-1">
                  Function URL<span className="ml-1 text-rose-600 dark:text-rose-400">*</span>
                </div>
                <div className="col-span-9">
                  <input
                    {...form.register('functionUrl')}
                    className="w-full max-w-sm px-2 py-1.5 rounded border bg-white dark:bg-neutral-700 border-zinc-200 dark:border-neutral-600 text-sm text-zinc-900 dark:text-zinc-100"
                    placeholder="Enter Function URL"
                  />
                </div>

                <div className="col-span-3 text-sm text-zinc-700 dark:text-zinc-300 pt-1">
                  HTTP Method
                </div>
                <div className="col-span-9">
                  <select
                    {...form.register('httpMethod')}
                    className="w-full max-w-sm px-2 py-1.5 rounded border bg-white dark:bg-neutral-700 border-zinc-200 dark:border-neutral-600 text-sm text-zinc-900 dark:text-zinc-100"
                  >
                    <option>GET</option>
                    <option>POST</option>
                    <option>PUT</option>
                    <option>PATCH</option>
                    <option>DELETE</option>
                  </select>
                </div>

                <div className="col-span-3 text-sm text-zinc-700 dark:text-zinc-300 pt-1">
                  Content Type
                </div>
                <div className="col-span-9">
                  <select
                    {...form.register('contentType')}
                    className="w-full max-w-sm px-2 py-1.5 rounded border bg-white dark:bg-neutral-700 border-zinc-200 dark:border-neutral-600 text-sm text-zinc-900 dark:text-zinc-100"
                  >
                    <option value="application/json">application/json</option>
                    <option value="text/plain">text/plain</option>
                    <option value="application/x-www-form-urlencoded">
                      application/x-www-form-urlencoded
                    </option>
                  </select>
                </div>

                <div className="col-span-3 text-sm text-zinc-700 dark:text-zinc-300 pt-1">
                  Advanced Options
                </div>
                <div className="col-span-9">
                  <div className="inline-flex items-center gap-2">
                    <Switch
                      checked={advancedOpen}
                      onCheckedChange={() => setAdvancedOpen((s) => !s)}
                    />
                    <span className="text-sm text-zinc-600 dark:text-zinc-400">Show</span>
                  </div>
                </div>

                {advancedOpen && (
                  <>
                    <div className="col-span-3 text-sm text-zinc-700 dark:text-zinc-300 pt-2">
                      Headers (JSON)
                    </div>
                    <div className="col-span-9">
                      <div className="mt-1">
                        <Controller
                          control={form.control}
                          name="headers"
                          render={({ field }) => {
                            const inputValue =
                              field.value === null || field.value === undefined
                                ? 'null'
                                : typeof field.value === 'string'
                                  ? field.value
                                  : JSON.stringify(field.value);

                            return (
                              <JsonCellEditor
                                value={inputValue}
                                nullable={true}
                                onValueChange={(v) => {
                                  if (v === 'null') {
                                    field.onChange(null);
                                    return;
                                  }
                                  try {
                                    const parsed = JSON.parse(v);
                                    field.onChange(parsed);
                                  } catch {
                                    // Keep as string if not valid JSON
                                    field.onChange(v);
                                  }
                                }}
                                onCancel={() => {
                                  /* keep current value */
                                }}
                                className="w-full"
                              />
                            );
                          }}
                        />
                      </div>
                    </div>

                    <div className="col-span-3 text-sm text-zinc-700 dark:text-zinc-300 pt-2">
                      Body (JSON)
                    </div>
                    <div className="col-span-9">
                      <div className="mt-1">
                        <Controller
                          control={form.control}
                          name="body"
                          render={({ field }) => {
                            const inputValue =
                              field.value === null || field.value === undefined
                                ? 'null'
                                : typeof field.value === 'string'
                                  ? field.value
                                  : JSON.stringify(field.value);

                            return (
                              <JsonCellEditor
                                value={inputValue}
                                nullable={true}
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
                                onCancel={() => {
                                  /* keep current value */
                                }}
                                className="w-full"
                              />
                            );
                          }}
                        />
                      </div>
                    </div>
                  </>
                )}
              </div>
            </div>
          </ScrollArea>

          {error && (
            <div className="mx-6 mb-6 shrink-0">
              <Alert variant="destructive">
                <AlertDescription>{error}</AlertDescription>
              </Alert>
            </div>
          )}

          <DialogFooter className="p-6 gap-3 sm:justify-end border-t border-zinc-200 dark:border-neutral-700 shrink-0">
            <Button
              type="button"
              variant="outline"
              onClick={() => onOpenChange(false)}
              className="h-10 px-4 dark:bg-neutral-600 dark:text-zinc-300 dark:border-neutral-600 dark:hover:bg-neutral-700"
            >
              Cancel
            </Button>
            <Button
              type="submit"
              className={cn(
                'h-10 px-4 bg-emerald-500 text-white hover:bg-emerald-600 dark:bg-emerald-300 dark:text-zinc-950 dark:hover:bg-emerald-400'
              )}
            >
              {mode === 'create' ? 'Create' : 'Save'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
