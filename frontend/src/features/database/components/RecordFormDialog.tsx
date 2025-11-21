import { useState, useEffect, useMemo } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { useQueryClient } from '@tanstack/react-query';
import { AlertCircle } from 'lucide-react';
import {
  Alert,
  AlertDescription,
  Button,
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
  ScrollArea,
} from '@/components';
import { useRecords } from '@/features/database/hooks/useRecords';
import { buildDynamicSchema, getInitialValues } from '@/features/database';
import { RecordFormField } from '@/features/database/components/RecordFormField';
import { cn } from '@/lib/utils/utils';
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
  const { createRecord, isCreating } = useRecords(tableName);

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

  const handleSubmit = form.handleSubmit(
    async (data) => {
      try {
        await createRecord(data);
        void queryClient.invalidateQueries({ queryKey: ['records', tableName] });
        void queryClient.invalidateQueries({ queryKey: ['table', tableName] });
        onOpenChange(false);
        form.reset();
        setError(null);
        if (onSuccess) {
          onSuccess();
        }
      } catch (err) {
        const errorMessage = err instanceof Error ? err.message : 'Failed to create record';
        setError(errorMessage);
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
                <RecordFormField
                  key={field.columnName}
                  field={field}
                  form={form}
                  tableName={tableName}
                />
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
              disabled={isCreating}
              className={cn(
                'h-10 px-4 bg-zinc-950 text-white hover:bg-zinc-800 dark:bg-emerald-300 dark:text-zinc-950 dark:hover:bg-emerald-400',
                isCreating && 'opacity-40'
              )}
            >
              {isCreating ? 'Saving...' : 'Add Record'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
