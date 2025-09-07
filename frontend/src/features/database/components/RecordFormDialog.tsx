import { useState, useEffect, useMemo } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { AlertCircle } from 'lucide-react';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@/components/radix/Dialog';
import { Button } from '@/components/radix/Button';
import { Alert, AlertDescription } from '@/components/radix/Alert';
import { ScrollArea } from '@/components/radix/ScrollArea';
import { databaseService } from '@/features/database/services/database.service';
import { buildDynamicSchema, getInitialValues } from '@/features/database';
import { FormField } from '@/features/database/components/FormField';
import { cn } from '@/lib/utils/utils';
import { useToast } from '@/lib/hooks/useToast';
import { ColumnSchema } from '@insforge/shared-schemas';
import { SYSTEM_FIELDS } from '../helpers';

interface RecordFormDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  tableName: string;
  schema: ColumnSchema[];
  onSuccess?: () => void;
}

export function RecordFormDialog({
  open,
  onOpenChange,
  tableName,
  schema,
  onSuccess,
}: RecordFormDialogProps) {
  const [error, setError] = useState<string | null>(null);
  const queryClient = useQueryClient();
  const { showToast } = useToast();

  const displayFields = useMemo(() => {
    const filteredFields = schema.filter((field) => !SYSTEM_FIELDS.includes(field.columnName));
    return filteredFields;
  }, [schema]);

  const dynamicSchema = useMemo(() => {
    const schema = buildDynamicSchema(displayFields);
    return schema;
  }, [displayFields]);

  const initialValues = useMemo(() => {
    const values = getInitialValues(displayFields);
    return values;
  }, [displayFields]);

  const form = useForm({
    resolver: zodResolver(dynamicSchema),
    defaultValues: initialValues,
  });

  useEffect(() => {
    form.reset(initialValues);
  }, [displayFields, schema, form, initialValues]);

  // Clear error state when dialog opens/closes
  useEffect(() => {
    if (!open) {
      setError(null);
    }
  }, [open]);

  const createRecordMutation = useMutation({
    mutationFn: (data: Record<string, any>) => {
      return databaseService.createRecord(tableName, data);
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['records', tableName] });
      void queryClient.invalidateQueries({ queryKey: ['table', tableName] });
      onOpenChange(false);
      form.reset();
      setError(null);
      if (onSuccess) {
        onSuccess();
      }
      showToast('Record created successfully', 'success');
    },
    onError: (err: Error) => {
      setError(err.message || 'Failed to create record');
    },
  });

  const handleSubmit = form.handleSubmit(
    async (data: Record<string, any>) => {
      try {
        await createRecordMutation.mutateAsync(data);
      } catch (err) {
        console.error('Form submission error:', err);
      }
    },
    (errors) => {
      console.error('Form validation errors:', errors);
    }
  );

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-160 p-0 gap-0 overflow-hidden flex flex-col">
        <form onSubmit={(e) => void handleSubmit(e)} className="flex flex-col">
          <DialogHeader className="px-6 py-3 border-b border-zinc-200 dark:border-neutral-700">
            <DialogTitle className="text-lg font-semibold text-zinc-950 dark:text-white">
              Add Record
            </DialogTitle>
          </DialogHeader>

          <ScrollArea className="h-full max-h-[540px] overflow-auto">
            <div className="p-6 space-y-6">
              {displayFields.map((field) => (
                <FormField key={field.columnName} field={field} form={form} tableName={tableName} />
              ))}
            </div>
          </ScrollArea>

          {error && (
            <div className="mx-6 mb-6 shrink-0">
              <Alert variant="destructive">
                <AlertCircle className="h-4 w-4" />
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
              disabled={createRecordMutation.isPending}
              className={cn(
                'h-10 px-4 bg-zinc-950 text-white hover:bg-zinc-800 dark:bg-emerald-300 dark:text-zinc-950 dark:hover:bg-emerald-400',
                createRecordMutation.isPending && 'opacity-40'
              )}
            >
              {createRecordMutation.isPending ? 'Saving...' : 'Add Record'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
