import { useState, useEffect, useMemo } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { useQueryClient } from '@tanstack/react-query';
import { AlertCircle, X } from 'lucide-react';
import {
  Button,
  Dialog,
  DialogCloseButton,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@insforge/ui';
import { ScrollArea } from '@/components';
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
      <DialogContent showCloseButton={false} className="w-[640px] max-w-[640px] p-0">
        <form onSubmit={(e) => void handleSubmit(e)} className="flex flex-col">
          <DialogHeader className="gap-0 px-4 py-3">
            <div className="flex w-full items-center gap-3">
              <div className="min-w-0 flex-1">
                <DialogTitle className="text-base font-medium leading-7 text-foreground">
                  Add Record
                </DialogTitle>
              </div>
              <DialogCloseButton
                className="relative right-auto top-auto h-8 w-8 rounded p-1 text-muted-foreground hover:bg-[var(--alpha-4)] hover:text-foreground"
                disabled={isCreating}
              >
                <X className="size-4" />
                <span className="sr-only">Close</span>
              </DialogCloseButton>
            </div>
          </DialogHeader>

          <ScrollArea className="max-h-[500px]">
            <div className="p-4">
              {displayFields.map((field, index) => (
                <div key={field.columnName}>
                  {index > 0 && (
                    <div className="flex h-5 items-center">
                      <div className="h-px w-full bg-[var(--alpha-8)]" />
                    </div>
                  )}
                  <RecordFormField field={field} form={form} tableName={tableName} />
                </div>
              ))}
            </div>
          </ScrollArea>

          <DialogFooter className="gap-3 px-4 py-4">
            {error && (
              <div className="mr-auto flex min-w-0 flex-1 items-center gap-1 text-sm leading-6 text-muted-foreground">
                <AlertCircle className="size-4 shrink-0 text-destructive" />
                <span className="truncate">{error}</span>
              </div>
            )}
            <Button
              type="button"
              variant="secondary"
              onClick={() => onOpenChange(false)}
              disabled={isCreating}
              className="h-8 rounded px-2"
            >
              Cancel
            </Button>
            <Button
              type="submit"
              disabled={isCreating}
              className={cn('h-8 rounded px-2', isCreating && 'opacity-40')}
            >
              {isCreating ? 'Saving...' : 'Add Record'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
