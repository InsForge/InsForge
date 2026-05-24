import { useCallback, useEffect, useId, useMemo, useState } from 'react';
import { AlertTriangle, Plus, Trash2 } from 'lucide-react';
import RefreshIcon from '#assets/icons/refresh.svg?react';
import {
  Button,
  Checkbox,
  ConfirmDialog,
  Dialog,
  DialogCloseButton,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  Input,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@insforge/ui';
import { useLocation, useNavigate } from 'react-router-dom';
import {
  ConvertedValue,
  DataGridEmptyState,
  DataGrid,
  type DataGridColumn,
  type DataGridRowType,
  EmptyState,
  TableHeader,
} from '#components';
import {
  useDatabaseSchemas,
  useIndexes,
  useIndexMutations,
} from '#features/database/hooks/useDatabase';
import { useDatabaseSchemaSelection } from '#features/database/hooks/useDatabaseSchemaSelection';
import { SQLModal, SQLCellButton } from '#features/database/components/SQLModal';
import { DatabaseStudioSidebarPanel } from '#features/database/components/DatabaseSidebar';
import { type DatabaseIndexesResponse } from '@insforge/shared-schemas';
import { DatabaseSchemaSelect } from '#features/database/components/DatabaseSchemaSelect';
import { DEFAULT_DATABASE_SCHEMA, getDatabaseSchemaInfo } from '#features/database/helpers';
import { useTables } from '#features/database/hooks/useTables';
import { useConfirm } from '#lib/hooks/useConfirm';
import { useToast } from '#lib/hooks/useToast';

// Must match backend IDENTIFIER_REGEX
// eslint-disable-next-line no-control-regex
const IDENTIFIER_REGEX = /^[^"\x00-\x1F\x7F]+$/;

function validateIdentifierFE(value: string): string | null {
  if (!value.trim()) return 'Name cannot be empty.';
  if (!IDENTIFIER_REGEX.test(value))
    return 'Name cannot contain double quotes or control characters.';
  return null;
}

interface IndexRow extends DataGridRowType {
  id: string;
  tableName: string;
  indexName: string;
  indexDef: string;
  isUnique: boolean | null;
  isPrimary: boolean | null;
  isValid: boolean | null;
  [key: string]: ConvertedValue | { [key: string]: string }[];
}

function parseIndexesFromResponse(response: DatabaseIndexesResponse | undefined): IndexRow[] {
  if (!response?.indexes) return [];
  return response.indexes.map((index) => ({
    id: `${index.tableName}_${index.indexName}`,
    tableName: index.tableName,
    indexName: index.indexName,
    indexDef: index.indexDef,
    isUnique: index.isUnique,
    isPrimary: index.isPrimary,
    isValid: index.isValid ?? null,
  }));
}

// ---------------------------------------------------------------------------
// CreateIndexDialog
// ---------------------------------------------------------------------------

const INDEX_METHODS = ['btree', 'hash', 'gin', 'gist', 'brin', 'ivfflat', 'hnsw'] as const;

interface CreateIndexDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  schemaName: string;
  onCreate: (args: {
    tableName: string;
    indexName: string;
    columns: string[];
    method: string;
    unique: boolean;
    concurrently: boolean;
  }) => Promise<void>;
}

function CreateIndexDialog({ open, onOpenChange, schemaName, onCreate }: CreateIndexDialogProps) {
  const tableSelectId = useId();
  const indexNameId = useId();

  const [tableName, setTableName] = useState('');
  const [indexName, setIndexName] = useState('');
  const [indexNameTouched, setIndexNameTouched] = useState(false);
  const [selectedColumns, setSelectedColumns] = useState<string[]>([]);
  const [method, setMethod] = useState<string>('btree');
  const [unique, setUnique] = useState(false);
  const [concurrently, setConcurrently] = useState(true);
  const [isCreating, setIsCreating] = useState(false);

  const { tables, useTableSchema } = useTables(schemaName);
  const { data: tableSchema, isLoading: isLoadingColumns } = useTableSchema(
    tableName,
    schemaName,
    !!tableName && open
  );
  const tableColumns = tableSchema?.columns ?? [];

  // Reset form when dialog opens
  useEffect(() => {
    if (open) {
      setTableName('');
      setIndexName('');
      setIndexNameTouched(false);
      setSelectedColumns([]);
      setMethod('btree');
      setUnique(false);
      setConcurrently(true);
      setIsCreating(false);
    }
  }, [open]);

  // Clear column selection when table changes
  useEffect(() => {
    setSelectedColumns([]);
  }, [tableName]);

  // Auto-suggest index name based on table + selected columns
  useEffect(() => {
    if (!indexNameTouched && tableName && selectedColumns.length > 0) {
      const parts = [tableName, ...selectedColumns].join('_');
      const suggestion = `idx_${parts}`.slice(0, 63); // PG identifier max 63 chars
      setIndexName(suggestion);
    }
  }, [tableName, selectedColumns, indexNameTouched]);

  const toggleColumn = (col: string) => {
    setSelectedColumns((prev) =>
      prev.includes(col) ? prev.filter((c) => c !== col) : [...prev, col]
    );
  };

  const indexNameError = indexNameTouched ? validateIdentifierFE(indexName) : null;

  const handleCreate = async () => {
    setIndexNameTouched(true);
    if (validateIdentifierFE(indexName)) return;
    setIsCreating(true);
    try {
      await onCreate({
        tableName,
        indexName: indexName.trim(),
        columns: selectedColumns,
        method,
        unique,
        concurrently,
      });
      onOpenChange(false);
    } catch {
      // keep dialog open; caller reports errors via toast
    } finally {
      setIsCreating(false);
    }
  };

  const isValid = !!tableName && !!indexName.trim() && selectedColumns.length > 0 && !indexNameError;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent showCloseButton={false} className="max-w-[520px] p-0">
        <div className="flex flex-col">
          <DialogHeader className="gap-0">
            <div className="flex w-full items-center gap-3">
              <div className="min-w-0 flex-1">
                <DialogTitle>Create Index</DialogTitle>
                <DialogDescription className="sr-only">
                  Create a new database index on a table.
                </DialogDescription>
              </div>
              <DialogCloseButton className="relative right-auto top-auto h-7 w-7 rounded p-1" />
            </div>
          </DialogHeader>

          <div className="flex flex-col gap-4 p-4">
            {/* Table */}
            <div className="flex flex-col gap-1.5">
              <label
                htmlFor={tableSelectId}
                className="text-sm font-normal leading-5 text-foreground"
              >
                Table
              </label>
              <Select value={tableName} onValueChange={setTableName}>
                <SelectTrigger id={tableSelectId} className="h-8 text-sm">
                  <SelectValue placeholder="Select a table" />
                </SelectTrigger>
                <SelectContent>
                  {tables.length === 0 ? (
                    <div className="px-2 py-1.5 text-sm text-muted-foreground">
                      No tables found
                    </div>
                  ) : (
                    tables.map((t) => (
                      <SelectItem key={t} value={t}>
                        {t}
                      </SelectItem>
                    ))
                  )}
                </SelectContent>
              </Select>
            </div>

            {/* Columns */}
            {tableName && (
              <div className="flex flex-col gap-1.5">
                <span className="text-sm font-normal leading-5 text-foreground">
                  Columns
                  {selectedColumns.length > 0 && (
                    <span className="ml-1.5 text-muted-foreground">
                      ({selectedColumns.length} selected)
                    </span>
                  )}
                </span>
                <div className="flex max-h-36 flex-col gap-0.5 overflow-y-auto rounded border border-border p-2">
                  {isLoadingColumns ? (
                    <span className="text-xs text-muted-foreground">Loading columns…</span>
                  ) : tableColumns.length === 0 ? (
                    <span className="text-xs text-muted-foreground">No columns found</span>
                  ) : (
                    tableColumns.map((col) => (
                      <label
                        key={col.columnName}
                        className="flex cursor-pointer items-center gap-2 rounded px-1 py-0.5 text-sm hover:bg-[var(--alpha-4)]"
                      >
                        <Checkbox
                          checked={selectedColumns.includes(col.columnName)}
                          onCheckedChange={() => toggleColumn(col.columnName)}
                        />
                        <span className="flex-1">{col.columnName}</span>
                        <span className="text-xs text-muted-foreground">{col.type}</span>
                      </label>
                    ))
                  )}
                </div>
              </div>
            )}

            {/* Index name */}
            <div className="flex flex-col gap-1.5">
              <label
                htmlFor={indexNameId}
                className="text-sm font-normal leading-5 text-foreground"
              >
                Index Name
              </label>
              <Input
                id={indexNameId}
                value={indexName}
                onChange={(e) => {
                  setIndexName(e.target.value);
                  setIndexNameTouched(true);
                }}
                onBlur={() => setIndexNameTouched(true)}
                placeholder="idx_table_column"
                className="h-8 px-1.5 py-1.5 text-sm leading-5"
                aria-invalid={!!indexNameError}
                aria-describedby={indexNameError ? `${indexNameId}-error` : undefined}
              />
              {indexNameError && (
                <p id={`${indexNameId}-error`} className="text-xs text-destructive">
                  {indexNameError}
                </p>
              )}
            </div>

            {/* Method */}
            <div className="flex flex-col gap-1.5">
              <span className="text-sm font-normal leading-5 text-foreground">Method</span>
              <Select value={method} onValueChange={setMethod}>
                <SelectTrigger className="h-8 text-sm">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {INDEX_METHODS.map((m) => (
                    <SelectItem key={m} value={m}>
                      {m}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            {/* Unique */}
            <label className="flex cursor-pointer items-center gap-2 text-sm font-normal leading-5 text-foreground">
              <Checkbox
                checked={unique}
                onCheckedChange={(checked) => setUnique(checked === true)}
              />
              Unique
            </label>

            {/* Concurrently */}
            <div className="flex flex-col gap-1">
              <label className="flex cursor-pointer items-center gap-2 text-sm font-normal leading-5 text-foreground">
                <Checkbox
                  checked={concurrently}
                  onCheckedChange={(checked) => setConcurrently(checked === true)}
                />
                Build concurrently
              </label>
              <p className="pl-6 text-xs text-muted-foreground">
                {concurrently
                  ? 'Avoids blocking writes while the index is being built. Recommended for production tables.'
                  : 'The table will be write-locked while the index is built. Only use on small or idle tables.'}
              </p>
            </div>

          </div>

          <DialogFooter className="gap-2 p-4">
            <Button
              type="button"
              variant="secondary"
              className="h-8 rounded px-2"
              disabled={isCreating}
              onClick={() => onOpenChange(false)}
            >
              Close
            </Button>
            <Button
              type="button"
              className="h-8 rounded px-2"
              disabled={!isValid || isCreating}
              onClick={() => void handleCreate()}
            >
              {isCreating ? 'Creating…' : 'Create'}
            </Button>
          </DialogFooter>
        </div>
      </DialogContent>
    </Dialog>
  );
}

// ---------------------------------------------------------------------------
// IndexBuildingDialog
// ---------------------------------------------------------------------------

function IndexBuildingDialog({ open, indexName, tableName }: { open: boolean; indexName: string; tableName: string }) {
  return (
    <Dialog open={open} onOpenChange={() => {}}>
      <DialogContent showCloseButton={false} className="max-w-[420px] p-0" onInteractOutside={(e) => e.preventDefault()}>
        <div className="flex flex-col gap-4 p-6">
          <div className="flex items-start gap-4">
            <RefreshIcon className="mt-0.5 h-5 w-5 shrink-0 animate-spin text-primary" />
            <div className="flex flex-col gap-1">
              <DialogTitle className="text-base font-semibold">Building Index</DialogTitle>
              <DialogDescription className="text-sm text-muted-foreground">
                Creating <span className="font-mono text-foreground">{indexName}</span> on{' '}
                <span className="font-mono text-foreground">{tableName}</span>.
              </DialogDescription>
              <p className="mt-1 text-xs text-muted-foreground">
                Large tables may take several minutes. Please keep this page open.
              </p>
            </div>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

// ---------------------------------------------------------------------------
// IndexesPage
// ---------------------------------------------------------------------------

export default function IndexesPage() {
  const location = useLocation();
  const navigate = useNavigate();
  const { selectedSchema, setSelectedSchema } = useDatabaseSchemaSelection();
  const [searchQuery, setSearchQuery] = useState('');
  const [isRefreshing, setIsRefreshing] = useState(false);
  const { schemas, isLoading: isLoadingSchemas } = useDatabaseSchemas();
  const selectedSchemaInfo = getDatabaseSchemaInfo(schemas, selectedSchema);
  const { data, isLoading, error, refetch } = useIndexes(selectedSchema, true);
  const [sqlModal, setSqlModal] = useState({ open: false, title: '', value: '' });
  const [createDialogOpen, setCreateDialogOpen] = useState(false);
  const [droppingIndexes, setDroppingIndexes] = useState<Set<string>>(new Set());
  const [buildingIndex, setBuildingIndex] = useState<{ indexName: string; tableName: string } | null>(null);

  const { createIndex, dropIndex } = useIndexMutations(selectedSchema);
  const { confirm, confirmDialogProps } = useConfirm();
  const { showToast } = useToast();

  const allIndexes = useMemo(() => parseIndexesFromResponse(data), [data]);

  const filteredIndexes = useMemo(() => {
    if (!searchQuery.trim()) {
      return allIndexes;
    }

    const query = searchQuery.toLowerCase();
    return allIndexes.filter(
      (index) =>
        index.indexName.toLowerCase().includes(query) ||
        index.tableName.toLowerCase().includes(query)
    );
  }, [allIndexes, searchQuery]);

  const handleRefresh = async () => {
    setIsRefreshing(true);
    try {
      setSearchQuery('');
      await refetch();
    } finally {
      setIsRefreshing(false);
    }
  };

  const handleCreateIndex = useCallback(
    async (args: {
      tableName: string;
      indexName: string;
      columns: string[];
      method: string;
      unique: boolean;
      concurrently: boolean;
    }) => {
      setBuildingIndex({ indexName: args.indexName, tableName: args.tableName });
      try {
        await createIndex(args);
        showToast(`Index "${args.indexName}" created successfully`, 'success');
      } catch (err) {
        showToast(err instanceof Error ? err.message : 'Failed to create index', 'error');
        throw err;
      } finally {
        setBuildingIndex(null);
      }
    },
    [createIndex, showToast]
  );

  const handleDropIndex = useCallback(
    async (row: IndexRow) => {
      const confirmed = await confirm({
        title: 'Drop Index',
        description: `Are you sure you want to drop "${row.indexName}"? This action cannot be undone.`,
        confirmText: 'Drop',
        destructive: true,
      });

      if (!confirmed) return;

      setDroppingIndexes((prev) => new Set(prev).add(row.indexName));
      try {
        await dropIndex(row.indexName);
        showToast(`Index "${row.indexName}" dropped successfully`, 'success');
      } catch (err) {
        showToast(err instanceof Error ? err.message : 'Failed to drop index', 'error');
      } finally {
        setDroppingIndexes((prev) => {
          const next = new Set(prev);
          next.delete(row.indexName);
          return next;
        });
      }
    },
    [confirm, dropIndex, showToast]
  );

  const columns: DataGridColumn<IndexRow>[] = useMemo(
    (): DataGridColumn<IndexRow>[] => [
      {
        key: 'tableName',
        name: 'Table',
        width: 'minmax(180px, 1.5fr)',
        resizable: true,
        sortable: true,
      },
      {
        key: 'indexName',
        name: 'Name',
        width: 'minmax(200px, 2fr)',
        resizable: true,
        sortable: true,
      },
      {
        key: 'isPrimary',
        name: 'Type',
        width: 'minmax(120px, 1fr)',
        resizable: true,
        sortable: true,
        renderCell: ({ row }) => {
          const isInvalid = row.isValid === false;

          if (isInvalid) {
            return (
              <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-xs font-medium bg-red-100 text-red-800 dark:bg-red-900/40 dark:text-red-300">
                <AlertTriangle className="h-3 w-3" />
                Invalid
              </span>
            );
          }
          if (row.isPrimary) {
            return (
              <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-gray-100 text-gray-800 dark:bg-gray-700 dark:text-gray-300">
                Primary
              </span>
            );
          }
          if (row.isUnique) {
            return (
              <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-gray-100 text-gray-800 dark:bg-gray-700 dark:text-gray-300">
                Unique
              </span>
            );
          }
          return (
            <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-gray-100 text-gray-800 dark:bg-gray-700 dark:text-gray-300">
              Index
            </span>
          );
        },
      },
      {
        key: 'indexDef',
        name: 'Definition',
        width: 'minmax(300px, 5fr)',
        resizable: true,
        renderCell: ({ row }) => (
          <SQLCellButton
            value={row.indexDef}
            onClick={() =>
              setSqlModal({ open: true, title: 'Index Definition', value: row.indexDef })
            }
          />
        ),
      },
      {
        key: 'actions',
        name: '',
        width: '52px',
        renderCell: ({ row }) => {
          if (row.isPrimary) return null;
          const isDropping = droppingIndexes.has(row.indexName as string);
          return (
            <TooltipProvider>
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    variant="ghost"
                    size="icon"
                    aria-label={`Drop index ${row.indexName}`}
                    className="h-7 w-7 rounded p-1 text-muted-foreground hover:text-destructive"
                    disabled={isDropping}
                    onClick={(e) => {
                      e.stopPropagation();
                      void handleDropIndex(row);
                    }}
                  >
                    <Trash2 className={`h-4 w-4 ${isDropping ? 'animate-pulse' : ''}`} />
                  </Button>
                </TooltipTrigger>
                <TooltipContent side="left">
                  {isDropping ? 'Dropping…' : 'Drop index'}
                </TooltipContent>
              </Tooltip>
            </TooltipProvider>
          );
        },
      },
    ],
    [droppingIndexes, handleDropIndex, setSqlModal]
  );

  useEffect(() => {
    if (isLoadingSchemas || schemas.length === 0) return;
    if (!schemas.some((schema) => schema.name === selectedSchema)) {
      setSelectedSchema(DEFAULT_DATABASE_SCHEMA, { replace: true });
    }
  }, [isLoadingSchemas, schemas, selectedSchema, setSelectedSchema]);

  const refreshButton = (
    <TooltipProvider>
      <Tooltip>
        <TooltipTrigger asChild>
          <Button
            variant="ghost"
            size="icon"
            className="h-8 w-8 rounded p-1.5 text-muted-foreground hover:bg-[var(--alpha-4)] active:bg-[var(--alpha-8)]"
            onClick={() => void handleRefresh()}
            disabled={isRefreshing}
          >
            <RefreshIcon className={isRefreshing ? 'h-5 w-5 animate-spin' : 'h-5 w-5'} />
          </Button>
        </TooltipTrigger>
        <TooltipContent side="bottom" align="center">
          <p>{isRefreshing ? 'Refreshing...' : 'Refresh indexes'}</p>
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );

  if (error) {
    return (
      <div className="flex h-full min-h-0 overflow-hidden bg-[rgb(var(--semantic-1))]">
        <DatabaseStudioSidebarPanel
          onBack={() =>
            void navigate(
              { pathname: '/dashboard/database/tables', search: location.search },
              { state: { slideFromStudio: true } }
            )
          }
        />
        <div className="min-w-0 flex-1 flex items-center justify-center bg-[rgb(var(--semantic-1))]">
          <EmptyState
            title="Failed to load indexes"
            description={error instanceof Error ? error.message : 'An error occurred'}
          />
        </div>
      </div>
    );
  }

  return (
    <div className="flex h-full min-h-0 overflow-hidden bg-[rgb(var(--semantic-1))]">
      <DatabaseStudioSidebarPanel
        onBack={() =>
          void navigate(
            { pathname: '/dashboard/database/tables', search: location.search },
            { state: { slideFromStudio: true } }
          )
        }
      />
      <div className="min-w-0 flex-1 flex flex-col overflow-hidden bg-[rgb(var(--semantic-1))]">
        <TableHeader
          title="Database Indexes"
          showDividerAfterTitle
          titleButtons={
            <div className="w-56">
              <DatabaseSchemaSelect
                schemas={schemas}
                value={selectedSchemaInfo.name}
                onValueChange={(schemaName) => {
                  setSearchQuery('');
                  setSelectedSchema(schemaName, { replace: true });
                }}
                disabled={isLoadingSchemas}
              />
            </div>
          }
          leftSlot={refreshButton}
          rightActions={
            <Button
              className="h-8 rounded px-2 text-sm"
              onClick={() => setCreateDialogOpen(true)}
              disabled={!!buildingIndex}
            >
              <Plus className="mr-1 h-4 w-4" />
              Create Index
            </Button>
          }
          searchValue={searchQuery}
          onSearchChange={setSearchQuery}
          searchPlaceholder="Search index"
        />
        {isLoading ? (
          <div className="min-h-0 flex-1 flex items-center justify-center">
            <EmptyState title="Loading indexes..." description="Please wait" />
          </div>
        ) : (
          <div className="min-h-0 flex-1 overflow-hidden">
            <DataGrid
              data={filteredIndexes}
              columns={columns}
              showSelection={false}
              showPagination={false}
              noPadding={true}
              className="h-full"
              isRefreshing={isRefreshing}
              emptyState={
                <DataGridEmptyState
                  message={
                    searchQuery ? 'No indexes match your search criteria' : 'No indexes found'
                  }
                />
              }
            />
          </div>
        )}

        <SQLModal
          open={sqlModal.open}
          onOpenChange={(open) => setSqlModal((prev) => ({ ...prev, open }))}
          title={sqlModal.title}
          value={sqlModal.value}
        />

        <CreateIndexDialog
          open={createDialogOpen}
          onOpenChange={setCreateDialogOpen}
          schemaName={selectedSchema}
          onCreate={handleCreateIndex}
        />

        <ConfirmDialog {...confirmDialogProps} />

        <IndexBuildingDialog
          open={!!buildingIndex}
          indexName={buildingIndex?.indexName ?? ''}
          tableName={buildingIndex?.tableName ?? ''}
        />
      </div>
    </div>
  );
}
