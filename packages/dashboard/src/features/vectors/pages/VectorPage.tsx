import { useState } from 'react';
import { Loader2, Plus, Trash2, Search, XCircle, Boxes } from 'lucide-react';
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
import {
  useCollections,
  useCreateCollection,
  useDeleteCollection,
  useQueryCollection,
} from '#features/vectors/hooks/useVectors';
import type { VectorMatch } from '@insforge/shared-schemas';

export default function VectorPage() {
  const [newName, setNewName] = useState('');
  const [deleteTarget, setDeleteTarget] = useState<string | null>(null);
  const [queryCollection, setQueryCollection] = useState<string>('');
  const [queryText, setQueryText] = useState('');
  const [matches, setMatches] = useState<VectorMatch[] | null>(null);

  const { data: collections = [], isLoading, error } = useCollections();
  const createCollection = useCreateCollection();
  const deleteCollection = useDeleteCollection();
  const runQuery = useQueryCollection();

  const handleCreate = async () => {
    if (!newName.trim()) {
      return;
    }
    try {
      await createCollection.mutateAsync(newName.trim());
      setNewName('');
    } catch {
      // toast handled in the hook
    }
  };

  const handleRunQuery = async () => {
    if (!queryCollection || !queryText.trim()) {
      return;
    }
    const result = await runQuery.mutateAsync({
      name: queryCollection,
      text: queryText.trim(),
      topK: 10,
    });
    setMatches(result);
  };

  return (
    <div className="h-full flex flex-col bg-[rgb(var(--semantic-0))]">
      <div className="flex-1 min-h-0 overflow-y-auto px-10">
        <div className="max-w-[1024px] w-full mx-auto flex flex-col gap-8 pt-10 pb-6">
          {/* Header */}
          <div className="flex flex-col gap-1">
            <h1 className="text-2xl font-medium text-foreground leading-8">Vector Store</h1>
            <p className="text-sm leading-5 text-muted-foreground">
              Manage embedding collections and run semantic similarity queries.
            </p>
          </div>

          {/* Create collection */}
          <div className="bg-card border border-[var(--alpha-8)] rounded-lg">
            <div className="p-3 border-b border-[var(--alpha-8)]">
              <p className="text-sm text-foreground">Create a collection</p>
            </div>
            <div className="flex items-end gap-4 p-6">
              <div className="flex-1 flex flex-col gap-1.5">
                <label className="text-sm text-foreground">Name</label>
                <Input
                  value={newName}
                  onChange={(e) => setNewName(e.target.value)}
                  placeholder="e.g. docs"
                />
              </div>
              <Button
                variant="primary"
                onClick={() => void handleCreate()}
                disabled={!newName.trim() || createCollection.isPending}
              >
                {createCollection.isPending ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <Plus className="h-4 w-4" />
                )}
                Create
              </Button>
            </div>
          </div>

          {/* Collections list */}
          {isLoading ? (
            <div className="flex flex-col gap-2">
              <Skeleton className="h-10 w-full" />
              <Skeleton className="h-10 w-full" />
            </div>
          ) : error ? (
            <div className="flex items-center gap-2 text-destructive">
              <XCircle className="w-5 h-5 shrink-0" />
              <span className="text-sm">Failed to load collections. Please refresh the page.</span>
            </div>
          ) : collections.length === 0 ? (
            <EmptyState
              icon={Boxes}
              title="No collections yet"
              description="Create a collection above, then upsert items from the SDK or an AI agent."
            />
          ) : (
            <div className="flex flex-col overflow-hidden rounded border border-[var(--alpha-8)] bg-card">
              <div className="grid h-9 shrink-0 grid-cols-[minmax(160px,1fr)_120px_120px_100px] items-center border-b border-[var(--alpha-8)] px-3 text-xs text-muted-foreground">
                <div>Name</div>
                <div>Dimension</div>
                <div>Metric</div>
                <div className="text-right">Actions</div>
              </div>
              {collections.map((collection) => (
                <div
                  key={collection.id}
                  className="grid grid-cols-[minmax(160px,1fr)_120px_120px_100px] items-center border-b border-[var(--alpha-8)] px-3 py-2 last:border-b-0"
                >
                  <div className="truncate font-mono text-sm text-foreground">
                    {collection.name}
                  </div>
                  <div className="text-sm text-muted-foreground">{collection.dimension}</div>
                  <div>
                    <Badge variant="default">{collection.metric}</Badge>
                  </div>
                  <div className="flex justify-end">
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => setDeleteTarget(collection.name)}
                    >
                      <Trash2 className="h-3.5 w-3.5 text-destructive" />
                    </Button>
                  </div>
                </div>
              ))}
            </div>
          )}

          {/* Query playground */}
          {collections.length > 0 && (
            <div className="bg-card border border-[var(--alpha-8)] rounded-lg">
              <div className="p-3 border-b border-[var(--alpha-8)]">
                <p className="text-sm text-foreground">Query playground</p>
              </div>
              <div className="flex flex-col gap-4 p-6">
                <div className="flex flex-wrap items-end gap-4">
                  <div className="flex flex-col gap-1.5">
                    <label className="text-sm text-foreground">Collection</label>
                    <Select value={queryCollection} onValueChange={setQueryCollection}>
                      <SelectTrigger className="w-[200px]">
                        <SelectValue placeholder="Select a collection" />
                      </SelectTrigger>
                      <SelectContent align="start">
                        {collections.map((collection) => (
                          <SelectItem key={collection.id} value={collection.name}>
                            {collection.name}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="flex-1 min-w-[220px] flex flex-col gap-1.5">
                    <label className="text-sm text-foreground">Query text</label>
                    <Input
                      value={queryText}
                      onChange={(e) => setQueryText(e.target.value)}
                      placeholder="Search by meaning…"
                    />
                  </div>
                  <Button
                    variant="primary"
                    onClick={() => void handleRunQuery()}
                    disabled={!queryCollection || !queryText.trim() || runQuery.isPending}
                  >
                    {runQuery.isPending ? (
                      <Loader2 className="h-4 w-4 animate-spin" />
                    ) : (
                      <Search className="h-4 w-4" />
                    )}
                    Search
                  </Button>
                </div>

                {matches !== null && (
                  <div className="flex flex-col gap-2">
                    {matches.length === 0 ? (
                      <p className="text-sm text-muted-foreground">No matches.</p>
                    ) : (
                      matches.map((match) => (
                        <div
                          key={match.id}
                          className="flex flex-col gap-1 rounded border border-[var(--alpha-8)] p-3"
                        >
                          <div className="flex items-center justify-between">
                            <span className="font-mono text-xs text-muted-foreground">
                              {match.id}
                            </span>
                            <Badge variant="default">score {match.score.toFixed(4)}</Badge>
                          </div>
                          {match.content && (
                            <p className="text-sm text-foreground">{match.content}</p>
                          )}
                        </div>
                      ))
                    )}
                  </div>
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
        title="Delete collection?"
        description={`This permanently deletes "${deleteTarget ?? ''}" and all of its vectors.`}
        confirmText="Delete"
        destructive
        isLoading={deleteCollection.isPending}
        onConfirm={async () => {
          if (deleteTarget) {
            await deleteCollection.mutateAsync(deleteTarget);
            if (queryCollection === deleteTarget) {
              setQueryCollection('');
              setMatches(null);
            }
            setDeleteTarget(null);
          }
        }}
      />
    </div>
  );
}
