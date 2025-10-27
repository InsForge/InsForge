import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { Plus, Upload } from 'lucide-react';
import PencilIcon from '@/assets/icons/pencil.svg?react';
import RefreshIcon from '@/assets/icons/refresh.svg?react';
import { useTables } from '@/features/database/hooks/useTables';
import { useRecords } from '@/features/database/hooks/useRecords';
import { Button } from '@/components/radix/Button';
import { Alert, AlertDescription } from '@/components/radix/Alert';
import { TableSidebar } from '@/features/database/components/TableSidebar';
import { RecordFormDialog } from '@/features/database/components/RecordFormDialog';
import { TableForm } from '@/features/database/components/TableForm';
import { ConfirmDialog } from '@/components/ConfirmDialog';
import { EmptyState } from '@/components/EmptyState';
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/radix/Tooltip';
import { useConfirm } from '@/lib/hooks/useConfirm';
import { useToast } from '@/lib/hooks/useToast';
import { DatabaseDataGrid } from '@/features/database/components/DatabaseDataGrid';
import { SearchInput, SelectionClearButton, DeleteActionButton } from '@/components';
import { ConnectCTA } from '@/components/ConnectCTA';
import { SortColumn } from 'react-data-grid';
import { convertValueForColumn, isIframe } from '@/lib/utils/utils';
import {
  DataUpdatePayload,
  DataUpdateResourceType,
  ServerEvents,
  SocketMessage,
  useSocket,
} from '@/lib/contexts/SocketContext';
import { useCSVImport } from '@/features/database/hooks/useCSVImport';

const PAGE_SIZE = 50;

function DatabasePageContent() {
  // Load selected table from localStorage on mount
  const [selectedTable, setSelectedTable] = useState<string | null>(() => {
    return localStorage.getItem('selectedTable');
  });
  const [pendingTableSelection, setPendingTableSelection] = useState<string>();
  const [showRecordForm, setShowRecordForm] = useState(false);
  const [isTableFormDirty, setIsTableFormDirty] = useState(false);
  const [showTableForm, setShowTableForm] = useState(false);
  const [editingTable, setEditingTable] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedRows, setSelectedRows] = useState<Set<string>>(new Set());
  const [sortColumns, setSortColumns] = useState<SortColumn[]>([]);
  const [currentPage, setCurrentPage] = useState(1);
  const [isSorting, setIsSorting] = useState(false);
  const [isRefreshing, setIsRefreshing] = useState(false);

  const { confirm, confirmDialogProps } = useConfirm();
  const { showToast } = useToast();
  const queryClient = useQueryClient();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const { tables, isLoadingTables, tablesError, deleteTable, useTableSchema, refetchTables } =
    useTables();

  const recordsHook = useRecords(selectedTable || '');

  const { socket, isConnected } = useSocket();

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

  // Persist selected table to localStorage when it changes
  useEffect(() => {
    if (selectedTable) {
      localStorage.setItem('selectedTable', selectedTable);
    } else {
      localStorage.removeItem('selectedTable');
    }
  }, [selectedTable]);

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
          totalRecords: recordsData.pagination.total ?? schemaData.recordCount,
        }
      : null;

  const isLoadingTable = isLoadingRecords;
  const tableError = recordsError;
  const refetchTableData = refetchRecords;

  useEffect(() => {
    if (!socket || !isConnected) {
      return;
    }

    const handleDataUpdate = (message: SocketMessage<DataUpdatePayload>) => {
      if (
        message.payload?.resource === DataUpdateResourceType.METADATA ||
        message.payload?.resource === DataUpdateResourceType.DATABASE_SCHEMA
      ) {
        // Invalidate all tables queries
        void queryClient.invalidateQueries({ queryKey: ['tables'] });
      }
    };

    socket.on(ServerEvents.DATA_UPDATE, handleDataUpdate);

    return () => {
      socket.off(ServerEvents.DATA_UPDATE, handleDataUpdate);
    };
  }, [socket, isConnected, queryClient]);

  // Reset sorting flag when loading completes
  useEffect(() => {
    if (!isLoadingTable && isSorting) {
      setIsSorting(false);
    }
  }, [isLoadingTable, isSorting]);

  // Auto-select first table (excluding system tables)
  useEffect(() => {
    if (!isLoadingTables && tables) {
      if (pendingTableSelection && tables.includes(pendingTableSelection)) {
        setSelectedTable(pendingTableSelection);
        setPendingTableSelection(undefined);
        return;
      }

      if (selectedTable && !tables.includes(selectedTable)) {
        setSelectedTable(null);
        return;
      }

      if (!selectedTable && tables.length && !showTableForm && !pendingTableSelection) {
        setSelectedTable(tables[0]);
      }
    }
  }, [tables, pendingTableSelection, selectedTable, showTableForm, isLoadingTables]);

  const handleRefresh = async () => {
    setIsRefreshing(true);
    try {
      // Reset all state
      setSelectedRows(new Set());
      setSortColumns([]);
      setSearchQuery('');
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
          setSelectedTable(tableName);
        }
      });
    } else {
      setSelectedTable(tableName);
    }
  };

  const handleCreateTable = () => {
    setSelectedTable(null);
    setEditingTable(null);
    setShowTableForm(true);
  };

  const handleEditTable = (tableName: string) => {
    setSelectedTable(tableName);
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
      // Update selectedTable BEFORE deleting to prevent queries on deleted table
      if (selectedTable === tableName) {
        setSelectedTable(null);
      }

      deleteTable(tableName);
    }
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
        await refetchTableData();
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
      await Promise.all([
        refetchTableData(),
        refetchTables(), // Also refresh tables to update sidebar record counts
      ]);
      setSelectedRows(new Set());
    }
  };

  const error = tablesError || tableError;

  // Calculate pagination
  const totalPages = Math.ceil((tableData?.totalRecords || 0) / PAGE_SIZE);

  return (
    <div className="flex h-full bg-bg-gray dark:bg-neutral-800">
      {/* Secondary Sidebar - Table List */}
      <TableSidebar
        tables={tables}
        selectedTable={selectedTable || undefined}
        onTableSelect={handleSelectTable}
        loading={isLoadingTables}
        onNewTable={handleCreateTable}
        onEditTable={handleEditTable}
        onDeleteTable={(tableName) => void handleDeleteTable(tableName)}
      />

      {/* Main Content Area */}
      <div className="flex-1 min-w-0 flex flex-col overflow-hidden">
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
              setPendingTableSelection(newTableName);
            }}
          />
        ) : (
          // Show normal content with header
          <>
            {/* Sticky Header Section */}
            {selectedTable && (
              <div className="sticky top-0 z-30 bg-bg-gray dark:bg-neutral-800">
                <div className="pl-4 pr-1.5 py-1.5 h-12">
                  {/* Page Header with Breadcrumb */}
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-3">
                      <nav className="flex items-center text-base font-semibold">
                        <span className="text-black dark:text-white">{selectedTable}</span>
                      </nav>

                      {/* Separator */}
                      <div className="h-6 w-px bg-gray-200 dark:bg-neutral-700" />

                      {/* Action buttons group */}
                      <div className="flex items-center gap-1">
                        <TooltipProvider>
                          <Tooltip>
                            <TooltipTrigger asChild>
                              <Button
                                variant="ghost"
                                size="icon"
                                className="p-1 h-9 w-9"
                                onClick={() => handleEditTable(selectedTable)}
                              >
                                <PencilIcon className="h-5 w-5 text-zinc-400 dark:text-neutral-400" />
                              </Button>
                            </TooltipTrigger>
                            <TooltipContent side="bottom" align="center">
                              <p>Edit Table</p>
                            </TooltipContent>
                          </Tooltip>
                          {!isIframe() && (
                            <Tooltip>
                              <TooltipTrigger asChild>
                                <Button
                                  variant="ghost"
                                  size="icon"
                                  className="p-1 h-9 w-9"
                                  onClick={() => void handleRefresh()}
                                  disabled={isRefreshing}
                                >
                                  <RefreshIcon className="h-5 w-5 text-zinc-400 dark:text-neutral-400" />
                                </Button>
                              </TooltipTrigger>
                              <TooltipContent side="bottom" align="center">
                                <p>{isRefreshing ? 'Refreshing...' : 'Refresh'}</p>
                              </TooltipContent>
                            </Tooltip>
                          )}
                        </TooltipProvider>
                      </div>
                    </div>
                  </div>
                </div>

                <div className="pt-2 pb-4 px-3">
                  {/* Search Bar and Actions - only show when table is selected */}
                  {selectedTable && (
                    <div className="flex items-center justify-between">
                      {selectedRows.size > 0 ? (
                        <div className="flex items-center gap-3">
                          <SelectionClearButton
                            selectedCount={selectedRows.size}
                            itemType="record"
                            onClear={() => setSelectedRows(new Set())}
                          />
                          {selectedTable !== 'users' && (
                            <DeleteActionButton
                              selectedCount={selectedRows.size}
                              itemType="record"
                              onDelete={() => void handleBulkDelete(Array.from(selectedRows))}
                            />
                          )}
                        </div>
                      ) : (
                        <SearchInput
                          value={searchQuery}
                          onChange={setSearchQuery}
                          placeholder="Search Records by any String Field"
                          className="flex-1 max-w-80 dark:bg-neutral-800 dark:text-zinc-300 dark:border-neutral-700"
                          debounceTime={300}
                        />
                      )}
                      <div className="flex items-center gap-2 ml-4">
                        {selectedRows.size === 0 && selectedTable !== 'users' && (
                          <>
                            {/* Import CSV Button */}
                            <Button
                              className="h-10 px-4 font-medium gap-1.5 dark:bg-emerald-300 dark:hover:bg-emerald-400 "
                              onClick={() => fileInputRef.current?.click()}
                              disabled={isImporting}
                            >
                              <Upload className="w-5 h-5" />
                              {isImporting ? 'Importing...' : 'Import CSV'}
                            </Button>
                            {/* Add Record Button */}
                            <Button
                              className="h-10 px-4 font-medium gap-1.5 dark:bg-emerald-300 dark:hover:bg-emerald-400"
                              onClick={() => setShowRecordForm(true)}
                            >
                              <Plus className="w-5 h-5" />
                              Add Record
                            </Button>
                          </>
                        )}
                      </div>
                    </div>
                  )}
                </div>
              </div>
            )}

            {/* Content - Full height without padding for table to fill */}
            <div className="flex-1 flex flex-col overflow-hidden">
              {error && (
                <Alert variant="destructive" className="mb-4 mx-8 mt-4">
                  <AlertDescription>{String(error)}</AlertDescription>
                </Alert>
              )}

              {!selectedTable ? (
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
                  onJumpToTable={setSelectedTable}
                  currentPage={currentPage}
                  totalPages={totalPages}
                  pageSize={PAGE_SIZE}
                  totalRecords={tableData?.totalRecords || 0}
                  onPageChange={setCurrentPage}
                  emptyState={
                    <div className="text-sm text-black dark:text-white">
                      {searchQuery ? 'No records match your search criteria' : 'No records found'}.{' '}
                      <ConnectCTA />
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
          onSuccess={() => {
            void refetchTableData();
            void refetchTables();
            // Also invalidate the schema cache to ensure fresh data
            void queryClient.invalidateQueries({ queryKey: ['table-schema', selectedTable] });
          }}
        />
      )}

      {/* Confirm Dialog */}
      <ConfirmDialog {...confirmDialogProps} />
    </div>
  );
}

export default function DatabasePage() {
  return <DatabasePageContent />;
}
