import { useState, useEffect, useCallback, useMemo, useRef, type CSSProperties } from 'react';
import { CirclePlus, LogIn } from 'lucide-react';
import PencilIcon from '@/assets/icons/pencil.svg?react';
import RefreshIcon from '@/assets/icons/refresh.svg?react';
import EmptyBoxSvg from '@/assets/images/empty_box.svg?react';
import { useTables } from '@/features/database/hooks/useTables';
import { useRecords } from '@/features/database/hooks/useRecords';
import { DatabaseSecondaryMenu } from '@/features/database/components/DatabaseSecondaryMenu';
import { RecordFormDialog } from '@/features/database/components/RecordFormDialog';
import { TableForm } from '@/features/database/components/TableForm';
import { TablesEmptyState } from '@/features/database/components/TablesEmptyState';
import { TemplatePreview } from '@/features/database/components/TemplatePreview';
import { DATABASE_TEMPLATES, DatabaseTemplate } from '@/features/database/templates';
import {
  Button,
  ConfirmDialog,
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@insforge/ui';
import {
  Alert,
  AlertDescription,
  EmptyState,
  SelectionClearButton,
  DeleteActionButton,
  TableHeader,
} from '@/components';
import { useConfirm } from '@/lib/hooks/useConfirm';
import { useToast } from '@/lib/hooks/useToast';
import { DatabaseDataGrid } from '@/features/database/components/DatabaseDataGrid';
import { SortColumn } from 'react-data-grid';
import { convertValueForColumn } from '@/lib/utils/utils';
import { useCSVImport } from '@/features/database/hooks/useCSVImport';
import { useLocation, useSearchParams } from 'react-router-dom';

const PAGE_SIZE = 50;

export default function TablesPage() {
  const location = useLocation();
  const [searchParams, setSearchParams] = useSearchParams();
  const shouldSlideBackToTables =
    (location.state as { slideFromStudio?: boolean } | null)?.slideFromStudio === true;
  const selectedTableFromQuery = searchParams.get('table')?.trim();
  const [showRecordForm, setShowRecordForm] = useState(false);
  const [isTableFormDirty, setIsTableFormDirty] = useState(false);
  const [showTableForm, setShowTableForm] = useState(false);
  const [editingTable, setEditingTable] = useState<string | null>(null);
  const [searchValue, setSearchValue] = useState('');
  const searchQuery = searchValue.trim();
  const [selectedRows, setSelectedRows] = useState<Set<string>>(new Set());
  const [sortColumns, setSortColumns] = useState<SortColumn[]>([]);
  const [currentPage, setCurrentPage] = useState(1);
  const [isSorting, setIsSorting] = useState(false);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [previewingTemplate, setPreviewingTemplate] = useState<DatabaseTemplate | null>(null);

  const { confirm, confirmDialogProps } = useConfirm();
  const { showToast } = useToast();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const { tables, isLoadingTables, tablesError, deleteTable, useTableSchema, refetchTables } =
    useTables();
  const selectedTable = useMemo(() => {
    if (isLoadingTables || !tables.length) {
      return null;
    }

    if (selectedTableFromQuery && tables.includes(selectedTableFromQuery)) {
      return selectedTableFromQuery;
    }

    return tables[0];
  }, [isLoadingTables, tables, selectedTableFromQuery]);
  const selectTable = useCallback(
    (tableName: string | null, replace: boolean = false) => {
      const nextSearchParams = new URLSearchParams(searchParams);
      if (tableName) {
        nextSearchParams.set('table', tableName);
      } else {
        nextSearchParams.delete('table');
      }
      setSearchParams(nextSearchParams, { replace });
    },
    [searchParams, setSearchParams]
  );

  const recordsHook = useRecords(selectedTable || '');

  const handleFileSelect = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (file && selectedTable) {
      importCSV(file);
    }
    // Reset file input to allow re-uploading the same file
    if (event.target) {
      event.target.value = '';
    }
  };

  // Keep URL query param in sync with active table selection with fallback-to-first behavior.
  useEffect(() => {
    if (isLoadingTables) {
      return;
    }

    if ((selectedTableFromQuery ?? null) === selectedTable) {
      return;
    }

    selectTable(selectedTable, true);
  }, [selectedTable, selectedTableFromQuery, isLoadingTables, selectTable]);

  // Reset page when search query or selected table changes
  useEffect(() => {
    setCurrentPage(1);
  }, [searchQuery, selectedTable]);

  // Clear selected rows when table changes
  useEffect(() => {
    setSelectedRows(new Set());
  }, [selectedTable]);

  // Safe sort columns change handler
  const handleSortColumnsChange = useCallback(
    (newSortColumns: SortColumn[]) => {
      try {
        setIsSorting(true);
        setSortColumns(newSortColumns);
        // isSorting will be reset when the query completes
      } catch {
        // Clear sorting on error
        setSortColumns([]);
        setIsSorting(false);
        showToast('Sorting failed. Please try a different sort option.', 'error');
      }
    },
    [showToast]
  );

  // Fetch schema for selected table
  const { data: schemaData } = useTableSchema(selectedTable || '', !!selectedTable);

  // Fetch schema for editing table
  const { data: editingTableSchema } = useTableSchema(editingTable || '', !!editingTable);

  const primaryKeyColumn = useMemo(() => {
    return schemaData?.columns.find((col) => col.isPrimaryKey)?.columnName;
  }, [schemaData]);

  const {
    mutate: importCSV,
    isPending: isImporting,
    reset: resetImport,
  } = useCSVImport(selectedTable || '', {
    onSuccess: (data) => {
      if (data.success) {
        showToast(data.message || 'Import successful!', 'success');
        void refetchTableData();
      } else {
        // This case handles validation errors returned with a 200 OK but success: false
        const errorMessage =
          data.message || 'CSV import failed due to validation errors. Please check the file.';
        showToast(errorMessage, 'error');
      }
      resetImport();
    },
    onError: (error: Error) => {
      // This handles 400/500 errors from the API client
      const message =
        error?.message || 'An unexpected error occurred during import. Please try again.';
      showToast(message, 'error');
      resetImport();
    },
  });

  // Fetch table records using the hook
  const offset = (currentPage - 1) * PAGE_SIZE;
  const {
    data: recordsData,
    isLoading: isLoadingRecords,
    error: recordsError,
    refetch: refetchRecords,
  } = recordsHook.useTableRecords(
    PAGE_SIZE,
    offset,
    searchQuery,
    sortColumns,
    !!selectedTable && !!schemaData
  );

  // Combine schema and records data
  const tableData =
    selectedTable && schemaData && recordsData
      ? {
          name: selectedTable,
          schema: schemaData,
          records: recordsData.records,
          totalRecords: searchQuery.trim()
            ? (recordsData.pagination?.total ?? recordsData.records.length)
            : Math.max(schemaData.recordCount ?? 0, recordsData.pagination?.total ?? 0),
        }
      : null;

  const isLoadingTable = isLoadingRecords;
  const tableError = recordsError;
  const refetchTableData = refetchRecords;

  // Reset sorting flag when loading completes
  useEffect(() => {
    if (!isLoadingTable && isSorting) {
      setIsSorting(false);
    }
  }, [isLoadingTable, isSorting]);

  const handleRefresh = async () => {
    setIsRefreshing(true);
    try {
      // Reset all state
      setSelectedRows(new Set());
      setSortColumns([]);
      setSearchValue('');
      setIsSorting(false);

      // Refresh current table data (if table is selected)
      if (selectedTable) {
        await refetchTableData();
      }
      await refetchTables();
    } finally {
      setIsRefreshing(false);
    }
  };

  const handleTableFormClose = async (): Promise<boolean> => {
    if (isTableFormDirty) {
      const confirmOptions = {
        title: 'Unsaved Changes',
        description: `You have unsaved changes. Do you want to discard the changes and exit the form?`,
        confirmText: 'Discard',
        destructive: true,
      };

      const shouldDiscard = await confirm(confirmOptions);
      if (shouldDiscard) {
        setShowTableForm(false);
        setEditingTable(null);
        return true;
      } else {
        return false;
      }
    } else {
      setShowTableForm(false);
      return true;
    }
  };

  const handleSelectTable = (tableName: string) => {
    if (showTableForm) {
      void handleTableFormClose().then((discarded) => {
        if (discarded) {
          selectTable(tableName);
        }
      });
    } else {
      selectTable(tableName);
    }
  };

  const handleCreateTable = () => {
    setEditingTable(null);
    setShowTableForm(true);
  };

  const handleEditTable = (tableName: string) => {
    selectTable(tableName);
    setEditingTable(tableName);
    setShowTableForm(true);
  };

  const handleDeleteTable = async (tableName: string) => {
    const confirmOptions = {
      title: 'Delete Table',
      description: `Are you sure you want to delete the table "${tableName}"? This will permanently delete all records in this table. This action cannot be undone.`,
      confirmText: 'Delete',
      destructive: true,
    };

    const shouldDelete = await confirm(confirmOptions);

    if (shouldDelete) {
      // Update selected table in URL BEFORE deleting to prevent queries on deleted table.
      if (selectedTable === tableName) {
        const nextTable = tables.find((table) => table !== tableName) ?? null;
        selectTable(nextTable, true);
      }

      deleteTable(tableName);
    }
  };

  const handleTemplateClick = (template: DatabaseTemplate) => {
    setPreviewingTemplate(template);
  };

  const handleCancelPreview = () => {
    setPreviewingTemplate(null);
  };

  // Handle record update
  const handleRecordUpdate = async (rowId: string, columnKey: string, newValue: string) => {
    if (!selectedTable) {
      return;
    }

    try {
      // Find column schema to determine the correct type conversion
      const columnSchema = tableData?.schema?.columns?.find((col) => col.columnName === columnKey);
      if (columnSchema) {
        // Convert value based on column type using utility function
        const conversionResult = convertValueForColumn(columnSchema.type, newValue);

        if (!conversionResult.success) {
          showToast(conversionResult.error || 'Invalid value', 'error');
          return;
        }
        const updates = { [columnKey]: conversionResult.value };
        await recordsHook.updateRecord({
          pkColumn: primaryKeyColumn || 'id',
          pkValue: rowId,
          data: updates,
        });
      }
    } catch (error) {
      showToast('Failed to update record', 'error');
      throw error;
    }
  };

  // Handle bulk delete
  const handleBulkDelete = async (ids: string[]) => {
    if (!selectedTable || !ids.length) {
      return;
    }

    const shouldDelete = await confirm({
      title: `Delete ${ids.length} ${ids.length === 1 ? 'Record' : 'Records'}`,
      description: `Are you sure you want to delete ${ids.length} ${ids.length === 1 ? 'record' : 'records'}? This action cannot be undone.`,
      confirmText: 'Delete',
      destructive: true,
    });

    if (shouldDelete) {
      await recordsHook.deleteRecords({ pkColumn: primaryKeyColumn || 'id', pkValues: ids });
      // Query invalidation is handled by the mutation, no manual refetch needed
      setSelectedRows(new Set());
    }
  };

  const error = tablesError || tableError;

  // Calculate pagination
  const totalPages = Math.ceil((tableData?.totalRecords || 0) / PAGE_SIZE);

  // Show empty state when there are no tables and not loading
  const showEmptyState = !isLoadingTables && tables?.length === 0 && !showTableForm;

  // Show template preview - takes full width without sidebar
  if (previewingTemplate) {
    return <TemplatePreview template={previewingTemplate} onCancel={handleCancelPreview} />;
  }

  return (
    <div className="flex h-full min-h-0 overflow-hidden bg-[rgb(var(--semantic-1))]">
      {/* Secondary Sidebar - Table List */}
      <DatabaseSecondaryMenu
        tables={tables}
        selectedTable={selectedTable || undefined}
        onTableSelect={handleSelectTable}
        loading={isLoadingTables}
        onNewTable={handleCreateTable}
        onEditTable={handleEditTable}
        onDeleteTable={(tableName) => void handleDeleteTable(tableName)}
        initialMode={shouldSlideBackToTables ? 'studio' : 'tables'}
        animateToMode={shouldSlideBackToTables ? 'tables' : undefined}
      />

      {/* Main Content Area */}
      <div className="min-w-0 flex-1 flex flex-col overflow-hidden">
        {showTableForm ? (
          // Show TableForm replacing entire main content area
          <TableForm
            open={showTableForm}
            onOpenChange={(open) => {
              if (!open) {
                void handleTableFormClose();
              }
            }}
            mode={editingTable ? 'edit' : 'create'}
            editTable={editingTable ? editingTableSchema : undefined}
            setFormIsDirty={setIsTableFormDirty}
            onSuccess={(newTableName?: string) => {
              void refetchTables();
              void refetchTableData();
              setShowTableForm(false);
              if (newTableName) {
                selectTable(newTableName);
              }
            }}
          />
        ) : (
          // Show normal content with header
          <>
            {selectedTable && (
              <TableHeader
                leftContent={
                  selectedRows.size > 0 ? (
                    <div className="flex items-center gap-2">
                      <SelectionClearButton
                        selectedCount={selectedRows.size}
                        itemType="record"
                        onClear={() => setSelectedRows(new Set())}
                      />
                      <DeleteActionButton
                        selectedCount={selectedRows.size}
                        itemType="record"
                        onDelete={() => void handleBulkDelete(Array.from(selectedRows))}
                      />
                    </div>
                  ) : (
                    <div className="flex min-w-0 items-center gap-3">
                      <h1 className="shrink-0 text-base font-medium leading-7 text-foreground">
                        {selectedTable}
                      </h1>
                      <div className="flex h-5 w-5 shrink-0 items-center justify-center">
                        <div className="h-5 w-px bg-[var(--alpha-8)]" />
                      </div>
                      <TooltipProvider>
                        <Tooltip>
                          <TooltipTrigger asChild>
                            <Button
                              variant="ghost"
                              size="icon"
                              onClick={() => handleEditTable(selectedTable)}
                              className="h-8 w-8 rounded p-1.5 text-muted-foreground hover:bg-[var(--alpha-4)] active:bg-[var(--alpha-8)]"
                            >
                              <PencilIcon className="h-5 w-5" />
                            </Button>
                          </TooltipTrigger>
                          <TooltipContent side="bottom" align="center">
                            <p>Edit table</p>
                          </TooltipContent>
                        </Tooltip>
                        <Tooltip>
                          <TooltipTrigger asChild>
                            <Button
                              variant="ghost"
                              size="icon"
                              onClick={() => void handleRefresh()}
                              disabled={isRefreshing}
                              className="h-8 w-8 rounded p-1.5 text-muted-foreground hover:bg-[var(--alpha-4)] active:bg-[var(--alpha-8)]"
                            >
                              <RefreshIcon
                                className={isRefreshing ? 'h-5 w-5 animate-spin' : 'h-5 w-5'}
                              />
                            </Button>
                          </TooltipTrigger>
                          <TooltipContent side="bottom" align="center">
                            <p>{isRefreshing ? 'Refreshing...' : 'Refresh records'}</p>
                          </TooltipContent>
                        </Tooltip>
                      </TooltipProvider>
                      <div className="flex h-5 w-5 shrink-0 items-center justify-center">
                        <div className="h-5 w-px bg-[var(--alpha-8)]" />
                      </div>
                      <Button
                        variant="ghost"
                        size="sm"
                        className="h-8 rounded px-1.5 text-primary hover:bg-[var(--alpha-4)] hover:text-primary active:bg-[var(--alpha-8)]"
                        onClick={() => setShowRecordForm(true)}
                      >
                        <CirclePlus className="h-6 w-6 stroke-[1.5] text-primary" />
                        <span className="px-1 text-sm font-medium leading-5">Add Record</span>
                      </Button>
                      <Button
                        variant="ghost"
                        size="sm"
                        className="h-8 rounded px-1.5 text-muted-foreground hover:bg-[var(--alpha-4)] hover:text-foreground active:bg-[var(--alpha-8)]"
                        onClick={() => fileInputRef.current?.click()}
                        disabled={isImporting}
                      >
                        <LogIn className="h-6 w-6 stroke-[1.5]" />
                        <span className="px-1 text-sm font-medium leading-5">
                          {isImporting ? 'Importing...' : 'Import CSV'}
                        </span>
                      </Button>
                    </div>
                  )
                }
                searchValue={searchValue}
                onSearchChange={setSearchValue}
                searchDebounceTime={300}
                searchPlaceholder="Search records"
              />
            )}

            {/* Content - Full height without padding for table to fill */}
            <div className="min-h-0 flex-1 flex flex-col overflow-hidden">
              {error && (
                <Alert variant="destructive" className="mx-4 mt-4">
                  <AlertDescription>{String(error)}</AlertDescription>
                </Alert>
              )}

              {showEmptyState ? (
                <TablesEmptyState
                  templates={DATABASE_TEMPLATES}
                  onCreateTable={handleCreateTable}
                  onTemplateClick={handleTemplateClick}
                />
              ) : !selectedTable ? (
                <div className="flex-1 flex items-center justify-center">
                  <EmptyState
                    title="No Table Selected"
                    description="Select a table from the sidebar to view its data"
                  />
                </div>
              ) : (
                <DatabaseDataGrid
                  data={tableData?.records || []}
                  schema={tableData?.schema}
                  loading={isLoadingTable && !tableData}
                  isSorting={isSorting}
                  isRefreshing={isRefreshing}
                  rowKeyGetter={(row) => String(row[primaryKeyColumn || 'id'])}
                  selectedRows={selectedRows}
                  onSelectedRowsChange={setSelectedRows}
                  sortColumns={sortColumns}
                  onSortColumnsChange={handleSortColumnsChange}
                  onCellEdit={handleRecordUpdate}
                  onJumpToTable={(tableName) => selectTable(tableName)}
                  currentPage={currentPage}
                  totalPages={totalPages}
                  pageSize={PAGE_SIZE}
                  totalRecords={tableData?.totalRecords || 0}
                  paginationRecordLabel="records"
                  onPageChange={setCurrentPage}
                  emptyState={
                    <div className="flex flex-col items-center gap-2 pb-12 pt-6 text-center">
                      <EmptyBoxSvg
                        className="h-[95px] w-[160px]"
                        style={
                          {
                            '--empty-box-fill-primary': 'rgb(var(--semantic-2))',
                            '--empty-box-fill-secondary': 'rgb(var(--semantic-6))',
                          } as CSSProperties
                        }
                        aria-hidden="true"
                      />
                      <p className="text-sm font-medium leading-6 text-muted-foreground">
                        No Records Found
                      </p>
                      {!searchQuery && (
                        <button
                          type="button"
                          className="text-xs leading-4 text-primary hover:underline"
                          onClick={() => setShowRecordForm(true)}
                        >
                          Add Record
                        </button>
                      )}
                    </div>
                  }
                />
              )}
            </div>
          </>
        )}
      </div>

      <input
        type="file"
        ref={fileInputRef}
        onChange={handleFileSelect}
        accept=".csv,text/csv"
        style={{ display: 'none' }}
      />

      {/* Add Record Form */}
      {selectedTable && schemaData && (
        // In the RecordForm onSuccess callback
        <RecordFormDialog
          open={showRecordForm}
          onOpenChange={setShowRecordForm}
          tableName={selectedTable}
          schema={schemaData.columns}
        />
      )}

      {/* Confirm Dialog */}
      <ConfirmDialog {...confirmDialogProps} />
    </div>
  );
}
