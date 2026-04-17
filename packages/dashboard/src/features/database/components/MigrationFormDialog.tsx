import { useEffect, useState } from 'react';
import type { CreateMigrationRequest } from '@insforge/shared-schemas';
import {
  Button,
  Dialog,
  DialogBody,
  DialogCloseButton,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  Input,
} from '@insforge/ui';
import { CodeEditor } from '../../../components';

interface MigrationFormDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSubmit: (payload: CreateMigrationRequest) => Promise<void>;
  isSubmitting: boolean;
}

interface MigrationFormRowProps {
  label: string;
  description?: React.ReactNode;
  children: React.ReactNode;
}

interface MigrationFormErrors {
  name: string;
  sql: string;
}

const EMPTY_ERRORS: MigrationFormErrors = {
  name: '',
  sql: '',
};

function MigrationFormRow({ label, description, children }: MigrationFormRowProps) {
  return (
    <div className="grid gap-3 md:grid-cols-[220px_minmax(0,1fr)] md:gap-6">
      <div className="space-y-1">
        <p className="text-sm leading-5 text-foreground">{label}</p>
        {description ? (
          <p className="text-[13px] leading-[18px] text-muted-foreground">{description}</p>
        ) : null}
      </div>
      <div className="min-w-0 flex-1">{children}</div>
    </div>
  );
}

export function MigrationFormDialog({
  open,
  onOpenChange,
  onSubmit,
  isSubmitting,
}: MigrationFormDialogProps) {
  const [name, setName] = useState('');
  const [sql, setSql] = useState('');
  const [errors, setErrors] = useState<MigrationFormErrors>(EMPTY_ERRORS);

  useEffect(() => {
    if (open) {
      setName('');
      setSql('');
      setErrors(EMPTY_ERRORS);
    }
  }, [open]);

  const isSubmitDisabled = isSubmitting || !name.trim() || !sql.trim();

  const handleSubmit = async () => {
    const nextErrors: MigrationFormErrors = {
      name: name.trim() ? '' : 'Migration name is required',
      sql: sql.trim() ? '' : 'Migration SQL is required',
    };

    if (nextErrors.name || nextErrors.sql) {
      setErrors(nextErrors);
      return;
    }

    try {
      setErrors(EMPTY_ERRORS);
      await onSubmit({
        name: name.trim(),
        sql: sql.trim(),
      });
    } catch (submitError) {
      const message =
        submitError instanceof Error ? submitError.message : 'Failed to execute migration';

      setErrors({
        name: message === 'Migration name already exists.' ? message : '',
        sql: message === 'Migration name already exists.' ? '' : message,
      });
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent showCloseButton={false} className="w-[960px] max-w-[calc(100vw-2rem)] p-0">
        <DialogHeader className="gap-0 border-b border-[var(--alpha-8)] px-6 py-4">
          <div className="flex w-full items-start gap-3">
            <div className="min-w-0 flex-1 space-y-1">
              <DialogTitle>Run Migration</DialogTitle>
              <DialogDescription>
                Use migrations to version and apply database schema changes over time.
              </DialogDescription>
            </div>
            <DialogCloseButton className="relative right-auto top-auto h-8 w-8 rounded p-1 text-muted-foreground hover:bg-[var(--alpha-4)] hover:text-foreground" />
          </div>
        </DialogHeader>

        <DialogBody className="gap-5 px-6 py-5">
          <MigrationFormRow label="Migration Name">
            <div className="flex w-full flex-col gap-1">
              <Input
                id="migration-name"
                value={name}
                onChange={(event) => {
                  setName(event.target.value);
                  setErrors((currentErrors) => ({ ...currentErrors, name: '' }));
                }}
                placeholder="create_posts_table"
                autoFocus
              />
              {errors.name ? <p className="text-sm text-destructive">{errors.name}</p> : null}
            </div>
          </MigrationFormRow>

          <MigrationFormRow label="SQL Statements">
            <div className="flex w-full flex-col gap-1">
              <div className="h-80 rounded-md border border-border bg-[rgb(var(--semantic-0))]">
                <CodeEditor
                  value={sql}
                  onChange={(value) => {
                    setSql(value);
                    setErrors((currentErrors) => ({ ...currentErrors, sql: '' }));
                  }}
                  editable
                  language="sql"
                  placeholder="CREATE TABLE posts (id UUID PRIMARY KEY DEFAULT gen_random_uuid());"
                  className="rounded-md"
                />
              </div>
              {errors.sql ? <p className="text-sm text-destructive">{errors.sql}</p> : null}
            </div>
          </MigrationFormRow>
        </DialogBody>

        <DialogFooter className="gap-3 border-t border-[var(--alpha-8)] px-6 py-4">
          <Button
            type="button"
            variant="secondary"
            onClick={() => onOpenChange(false)}
            className="h-8 px-2"
          >
            Cancel
          </Button>
          <Button
            type="button"
            onClick={() => void handleSubmit()}
            disabled={isSubmitDisabled}
            className="h-8 px-2"
          >
            {isSubmitting ? 'Running...' : 'Run Migration'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
