import { useRef, useState } from 'react';
import { Loader2, Plus, Trash2, Eye, XCircle, KeyRound } from 'lucide-react';
import {
  Button,
  Input,
  Badge,
  EmptyState,
  Skeleton,
  ConfirmDialog,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@insforge/ui';
import { useKvKeys, useSetKvEntry, useDeleteKvEntry } from '#features/kv/hooks/useKv';
import { kvService } from '#features/kv/services/kv.service';
import type { KvVisibility } from '@insforge/shared-schemas';

// Parse the value field as JSON, falling back to a plain string so the form
// accepts both `{"a":1}` and `hello` without forcing the user to quote scalars.
function parseValue(text: string): unknown {
  const trimmed = text.trim();
  if (trimmed === '') {
    return null;
  }
  try {
    return JSON.parse(trimmed);
  } catch {
    return text;
  }
}

function formatExpiry(expiresAt: string | null): string {
  if (expiresAt === null) {
    return 'Never';
  }
  return new Date(expiresAt).toLocaleString(undefined, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

export default function KvPage() {
  const [namespace, setNamespace] = useState('default');
  const [newKey, setNewKey] = useState('');
  const [newValue, setNewValue] = useState('');
  const [visibility, setVisibility] = useState<KvVisibility>('private');
  const [deleteTarget, setDeleteTarget] = useState<string | null>(null);
  const [viewKey, setViewKey] = useState<string | null>(null);
  const [viewValue, setViewValue] = useState<unknown>(null);
  const [viewLoading, setViewLoading] = useState(false);
  // Monotonic id so a slow getValue() can't overwrite a newer view request.
  const viewRequestId = useRef(0);

  // Guard against an empty namespace (e.g. the input cleared) producing invalid
  // list/save requests.
  const activeNamespace = namespace.trim();

  const { data: keys = [], isLoading, error } = useKvKeys(activeNamespace);
  const setEntry = useSetKvEntry(activeNamespace);
  const deleteEntry = useDeleteKvEntry(activeNamespace);

  const handleSave = async () => {
    if (!newKey.trim() || !activeNamespace) {
      return;
    }
    try {
      await setEntry.mutateAsync({
        key: newKey.trim(),
        input: { value: parseValue(newValue), visibility },
      });
      setNewKey('');
      setNewValue('');
    } catch {
      // error toast handled in the hook
    }
  };

  const handleView = async (key: string) => {
    const requestId = ++viewRequestId.current;
    setViewKey(key);
    setViewLoading(true);
    setViewValue(null);
    try {
      const value = await kvService.getValue(activeNamespace, key);
      if (viewRequestId.current === requestId) {
        setViewValue(value);
      }
    } catch {
      if (viewRequestId.current === requestId) {
        setViewValue('(failed to load value)');
      }
    } finally {
      if (viewRequestId.current === requestId) {
        setViewLoading(false);
      }
    }
  };

  return (
    <div className="h-full flex flex-col bg-[rgb(var(--semantic-0))]">
      <div className="flex-1 min-h-0 overflow-y-auto px-10">
        <div className="max-w-[1024px] w-full mx-auto flex flex-col gap-8 pt-10 pb-6">
          {/* Header */}
          <div className="flex flex-col gap-1">
            <h1 className="text-2xl font-medium text-foreground leading-8">Key-Value Store</h1>
            <p className="text-sm leading-5 text-muted-foreground">
              Browse and manage the project-global key-value store. New keys default to a 30-day
              TTL.
            </p>
          </div>

          {/* Namespace selector */}
          <div className="flex items-end gap-3">
            <div className="flex flex-col gap-1.5">
              <label className="text-sm text-foreground">Namespace</label>
              <Input
                value={namespace}
                onChange={(e) => setNamespace(e.target.value)}
                placeholder="default"
                className="w-[280px]"
              />
            </div>
          </div>

          {/* Create form */}
          <div className="bg-card border border-[var(--alpha-8)] rounded-lg">
            <div className="p-3 border-b border-[var(--alpha-8)]">
              <p className="text-sm text-foreground">Add or overwrite a key</p>
            </div>
            <div className="flex flex-wrap items-end gap-4 p-6">
              <div className="flex-1 min-w-[180px] flex flex-col gap-1.5">
                <label className="text-sm text-foreground">Key</label>
                <Input
                  value={newKey}
                  onChange={(e) => setNewKey(e.target.value)}
                  placeholder="e.g. feature:new-checkout"
                />
              </div>
              <div className="flex-1 min-w-[180px] flex flex-col gap-1.5">
                <label className="text-sm text-foreground">Value (JSON or text)</label>
                <Input
                  value={newValue}
                  onChange={(e) => setNewValue(e.target.value)}
                  placeholder='{"enabled": true}'
                />
              </div>
              <div className="flex flex-col gap-1.5">
                <label className="text-sm text-foreground">Visibility</label>
                <Select value={visibility} onValueChange={(v) => setVisibility(v as KvVisibility)}>
                  <SelectTrigger className="w-[140px]">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent align="start">
                    <SelectItem value="private">private</SelectItem>
                    <SelectItem value="authed">authed</SelectItem>
                    <SelectItem value="public">public</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <Button
                variant="primary"
                onClick={() => void handleSave()}
                disabled={!newKey.trim() || !activeNamespace || setEntry.isPending}
              >
                {setEntry.isPending ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <Plus className="h-4 w-4" />
                )}
                Save
              </Button>
            </div>
          </div>

          {/* Keys list */}
          {isLoading ? (
            <div className="flex flex-col gap-2">
              <Skeleton className="h-10 w-full" />
              <Skeleton className="h-10 w-full" />
              <Skeleton className="h-10 w-full" />
            </div>
          ) : error ? (
            <div className="flex items-center gap-2 text-destructive">
              <XCircle className="w-5 h-5 shrink-0" />
              <span className="text-sm">Failed to load keys. Please refresh the page.</span>
            </div>
          ) : keys.length === 0 ? (
            <EmptyState
              icon={KeyRound}
              title="No keys in this namespace"
              description="Add a key above, or write one from the SDK or an AI agent."
            />
          ) : (
            <div className="flex max-h-full flex-col overflow-hidden rounded border border-[var(--alpha-8)] bg-card">
              <div className="grid h-9 shrink-0 grid-cols-[minmax(160px,1fr)_120px_200px_120px] items-center border-b border-[var(--alpha-8)] px-3 text-xs text-muted-foreground">
                <div>Key</div>
                <div>Visibility</div>
                <div>Expires</div>
                <div className="text-right">Actions</div>
              </div>
              <div className="min-h-0 overflow-y-auto">
                {keys.map((entry) => (
                  <div
                    key={entry.key}
                    className="grid grid-cols-[minmax(160px,1fr)_120px_200px_120px] items-center border-b border-[var(--alpha-8)] px-3 py-2 last:border-b-0"
                  >
                    <div className="truncate font-mono text-sm text-foreground">{entry.key}</div>
                    <div>
                      <Badge variant="default">{entry.visibility}</Badge>
                    </div>
                    <div className="text-sm text-muted-foreground">
                      {formatExpiry(entry.expiresAt)}
                    </div>
                    <div className="flex justify-end gap-1">
                      <Button
                        variant="ghost"
                        size="sm"
                        aria-label={`View ${entry.key}`}
                        onClick={() => void handleView(entry.key)}
                      >
                        <Eye className="h-3.5 w-3.5" />
                      </Button>
                      <Button
                        variant="ghost"
                        size="sm"
                        aria-label={`Delete ${entry.key}`}
                        onClick={() => setDeleteTarget(entry.key)}
                      >
                        <Trash2 className="h-3.5 w-3.5 text-destructive" />
                      </Button>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Inline value viewer */}
          {viewKey !== null && (
            <div className="bg-card border border-[var(--alpha-8)] rounded-lg">
              <div className="flex items-center justify-between p-3 border-b border-[var(--alpha-8)]">
                <p className="font-mono text-sm text-foreground">{viewKey}</p>
                <Button variant="ghost" size="sm" onClick={() => setViewKey(null)}>
                  Close
                </Button>
              </div>
              <div className="p-4">
                {viewLoading ? (
                  <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
                ) : (
                  <pre className="overflow-x-auto whitespace-pre-wrap break-all text-xs text-foreground">
                    {JSON.stringify(viewValue, null, 2)}
                  </pre>
                )}
              </div>
            </div>
          )}
        </div>
      </div>

      <ConfirmDialog
        open={deleteTarget !== null}
        onOpenChange={(open) => {
          if (!open) {
            setDeleteTarget(null);
          }
        }}
        title="Delete key?"
        description={`This permanently deletes "${deleteTarget ?? ''}" from the "${namespace}" namespace.`}
        confirmText="Delete"
        destructive
        isLoading={deleteEntry.isPending}
        onConfirm={async () => {
          if (deleteTarget) {
            await deleteEntry.mutateAsync(deleteTarget);
            if (viewKey === deleteTarget) {
              setViewKey(null);
            }
            setDeleteTarget(null);
          }
        }}
      />
    </div>
  );
}
