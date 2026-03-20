import { useEffect, useMemo, useState, type ClipboardEvent } from 'react';
import { Plus, Trash2 } from 'lucide-react';
import { Button, Dialog, DialogContent, DialogDescription, DialogTitle, Input } from '@insforge/ui';
import type { DeploymentEnvVar } from '@insforge/shared-schemas';
import {
  createEnvVarDraft,
  normalizeEnvVarDrafts,
  parseDotEnvInput,
  type EnvVarDraft,
} from '../helpers';

type EnvVarSaveInput = {
  key: string;
  value: string;
};

interface EnvVarDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  envVar?: DeploymentEnvVar | null;
  onSave: (entries: EnvVarSaveInput[]) => Promise<boolean>;
  isSaving?: boolean;
}

export function EnvVarDialog({
  open,
  onOpenChange,
  envVar,
  onSave,
  isSaving = false,
}: EnvVarDialogProps) {
  const [key, setKey] = useState('');
  const [value, setValue] = useState('');
  const [manualDrafts, setManualDrafts] = useState<EnvVarDraft[]>([createEnvVarDraft()]);

  const isEditMode = !!envVar;
  const title = isEditMode ? 'Edit Environment Variable' : 'Add Environment Variables';
  const submitLabel = isEditMode ? 'Save' : 'Add';

  useEffect(() => {
    if (!open) {
      return;
    }

    setKey(envVar?.key ?? '');
    setValue('');
    setManualDrafts([createEnvVarDraft()]);
  }, [open, envVar]);

  const manualEntries = useMemo(() => normalizeEnvVarDrafts(manualDrafts), [manualDrafts]);

  const hasIncompleteManualRows = manualDrafts.some((draft) => {
    const hasAnyValue = draft.key.trim() || draft.value.trim();
    return hasAnyValue && (!draft.key.trim() || !draft.value.trim());
  });

  const isValid = isEditMode
    ? Boolean(key.trim() && value.trim())
    : manualEntries.length > 0 && !hasIncompleteManualRows;

  const handleClose = () => {
    onOpenChange(false);
  };

  const handleSubmit = async () => {
    const payload = isEditMode ? [{ key: key.trim(), value: value.trim() }] : manualEntries;

    const success = await onSave(payload);
    if (success) {
      handleClose();
    }
  };

  const updateManualDraft = (draftId: string, field: 'key' | 'value', nextValue: string) => {
    setManualDrafts((currentDrafts) =>
      currentDrafts.map((draft) =>
        draft.id === draftId
          ? {
              ...draft,
              [field]: nextValue,
            }
          : draft
      )
    );
  };

  const addManualDraft = () => {
    setManualDrafts((currentDrafts) => [...currentDrafts, createEnvVarDraft()]);
  };

  const applyPastedEnvVars = (draftIndex: number, pastedText: string) => {
    const parsed = parseDotEnvInput(pastedText);
    const normalizedEntries = normalizeEnvVarDrafts(parsed.drafts);

    if (normalizedEntries.length === 0) {
      return false;
    }

    setManualDrafts((currentDrafts) => {
      const nextDrafts = [...currentDrafts];
      const targetDraft = nextDrafts[draftIndex];
      const shouldReplaceTarget =
        targetDraft && !targetDraft.key.trim() && !targetDraft.value.trim();

      if (shouldReplaceTarget) {
        nextDrafts[draftIndex] = createEnvVarDraft(normalizedEntries[0]);
        nextDrafts.splice(
          draftIndex + 1,
          0,
          ...normalizedEntries.slice(1).map((entry) => createEnvVarDraft(entry))
        );
      } else {
        nextDrafts.splice(
          draftIndex + 1,
          0,
          ...normalizedEntries.map((entry) => createEnvVarDraft(entry))
        );
      }

      return nextDrafts;
    });

    return true;
  };

  const handleDraftPaste = (draftIndex: number) => (event: ClipboardEvent<HTMLInputElement>) => {
    const pastedText = event.clipboardData.getData('text');
    const looksLikeEnvPaste =
      pastedText.includes('\n') ||
      pastedText.startsWith('export ') ||
      /^[A-Za-z_][A-Za-z0-9_]*=/.test(pastedText.trim());

    if (!looksLikeEnvPaste) {
      return;
    }

    const wasApplied = applyPastedEnvVars(draftIndex, pastedText);
    if (!wasApplied) {
      return;
    }

    event.preventDefault();
  };

  const removeManualDraft = (draftId: string) => {
    setManualDrafts((currentDrafts) => {
      if (currentDrafts.length === 1) {
        return [createEnvVarDraft()];
      }

      return currentDrafts.filter((draft) => draft.id !== draftId);
    });
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <div className="flex items-center justify-between px-6 py-3 border-b border-neutral-200 dark:border-neutral-700">
          <DialogTitle className="text-lg font-semibold text-zinc-950 dark:text-white leading-7">
            {title}
          </DialogTitle>
        </div>
        <DialogDescription className="sr-only">
          Configure deployment environment variables
        </DialogDescription>

        <div className="flex max-h-[70vh] flex-col gap-6 overflow-y-auto p-6">
          {isEditMode ? (
            <>
              <div className="flex items-center gap-2">
                <label className="w-30 shrink-0 text-sm text-zinc-950 dark:text-neutral-50">
                  Key
                </label>
                <Input
                  placeholder="e.g CLIENT_KEY"
                  value={key}
                  onChange={(e) => setKey(e.target.value)}
                  className="flex-1"
                />
              </div>

              <div className="flex items-center gap-2">
                <label className="w-30 shrink-0 text-sm text-zinc-950 dark:text-neutral-50">
                  Value
                </label>
                <Input
                  placeholder="Enter value"
                  value={value}
                  onChange={(e) => setValue(e.target.value)}
                  className="flex-1"
                />
              </div>
            </>
          ) : (
            <>
              <div className="flex flex-col gap-3">
                <p className="text-sm text-muted-foreground dark:text-neutral-400">
                  Add multiple variables at once, or paste a `.env` block into any row to split it
                  into separate entries automatically.
                </p>
              </div>

              <div className="flex flex-col gap-4">
                <div className="flex items-center justify-between">
                  <p className="text-sm font-medium text-zinc-950 dark:text-white">Variables</p>
                  <Button variant="secondary" size="sm" onClick={addManualDraft}>
                    <Plus className="mr-2 h-4 w-4" />
                    Add row
                  </Button>
                </div>

                <div className="flex flex-col gap-3">
                  {manualDrafts.map((draft, index) => (
                    <div
                      key={draft.id}
                      className="grid grid-cols-[minmax(0,1fr)_minmax(0,1fr)_auto] gap-3"
                    >
                      <Input
                        placeholder={`Key ${index + 1}`}
                        value={draft.key}
                        onChange={(e) => updateManualDraft(draft.id, 'key', e.target.value)}
                        onPaste={handleDraftPaste(index)}
                      />
                      <Input
                        placeholder="Value"
                        value={draft.value}
                        onChange={(e) => updateManualDraft(draft.id, 'value', e.target.value)}
                        onPaste={handleDraftPaste(index)}
                      />
                      <Button
                        type="button"
                        variant="secondary"
                        size="icon"
                        onClick={() => removeManualDraft(draft.id)}
                        className="h-9 w-9"
                        aria-label={`Remove environment variable row ${index + 1}`}
                      >
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </div>
                  ))}
                </div>

                {hasIncompleteManualRows && (
                  <p className="text-sm text-amber-600 dark:text-amber-400">
                    Each filled row needs both a key and a value.
                  </p>
                )}
              </div>
            </>
          )}
        </div>

        <div className="flex gap-3 p-6 border-t border-neutral-200 dark:border-neutral-700">
          <Button
            variant="secondary"
            onClick={handleClose}
            className="flex-1 h-9 bg-neutral-200 dark:bg-neutral-600 hover:bg-neutral-300 dark:hover:bg-neutral-500 text-zinc-950 dark:text-white"
          >
            Cancel
          </Button>
          <Button
            onClick={() => void handleSubmit()}
            disabled={!isValid || isSaving}
            className="flex-1 h-9 bg-zinc-950 text-white hover:bg-zinc-800 disabled:opacity-40 dark:bg-emerald-300 dark:text-zinc-950 dark:hover:bg-emerald-400"
          >
            {isSaving ? 'Saving...' : submitLabel}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
