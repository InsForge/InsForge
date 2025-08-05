import { useState, useEffect, useMemo, useCallback } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Plus } from 'lucide-react';
import PencilIcon from '@/assets/icons/pencil.svg';
import RefreshIcon from '@/assets/icons/refresh.svg';
import EmptyDatabase from '@/assets/icons/empty_table.svg';
import { databaseService } from '@/features/database/services/database.service';
import { metadataService } from '@/features/dashboard/services/metadata.service';
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
import { SearchInput, SelectionClearButton } from '@/components';
import { SortColumn } from 'react-data-grid';
import { convertValueForColumn } from '@/lib/utils/database-utils';

export default function DatabasePage() {
  // Load selected table from localStorage on mount
  const [selectedTable, setSelectedTable] = useState<string | null>(() => {
    return localStorage.getItem('selectedTable');
  });
  const [showRecordForm, setShowRecordForm] = useState(false);
  const [showTableForm, setShowTableForm] = useState(false);
  const [editingTable, setEditingTable] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedRows, setSelectedRows] = useState<Set<string>>(new Set());
  const [sortColumns, setSortColumns] = useState<SortColumn[]>([]);
  const [currentPage, setCurrentPage] = useState(1);
  const [pageSize] = useState(50);
  const [isSorting, setIsSorting] = useState(false);
  const [isRefreshing, setIsRefreshing] = useState(false);

  const { confirm, ConfirmDialogProps } = useConfirm();
  const { showToast } = useToast();
  const queryClient = useQueryClient();

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

  // Ensure API key is fetched
  const { data: apiKey } = useQuery({
    queryKey: ['apiKey'],
    queryFn: () => metadataService.fetchApiKey(),
    staleTime: Infinity,
  });

  // Fetch metadata
  const {
    data: metadata,
    isLoading,
    error: metadataError,
    refetch: refetchMetadata,
  } = useQuery({
    queryKey: ['metadata'],
    queryFn: () => metadataService.getAppMetadata(),
    enabled: !!apiKey,
  });

  // Fetch table data when selected
  const {
    data: tableData,
    isLoading: isLoadingTable,
    error: tableError,
    refetch: refetchTableData,
  } = useQuery({
    queryKey: [
      'table',
      selectedTable,
      currentPage,
      pageSize,
      searchQuery,
      JSON.stringify(sortColumns),
    ],
    queryFn: async () => {
      if (!selectedTable) {
        return null;
      }

      const offset = (currentPage - 1) * pageSize;

      try {
        const [schema, records] = await Promise.all([
          databaseService.getTableSchema(selectedTable),
          databaseService.getTableRecords(
            selectedTable,
            pageSize,
            offset,
            searchQuery,
            sortColumns
          ),
        ]);

        return {
          name: selectedTable,
          schema,
          records: records.records,
          totalRecords: records.total,
        };
      } catch (error) {
        // If sorting caused the error, retry without sorting
        if (sortColumns && sortColumns.length > 0) {
          setSortColumns([]);

          const [schema, records] = await Promise.all([
            databaseService.getTableSchema(selectedTable),
            databaseService.getTableRecords(selectedTable, pageSize, offset, searchQuery, []),
          ]);

          showToast('Sorting not supported for this table. Showing unsorted results.', 'info');

          return {
            name: selectedTable,
            schema,
            records: records.records,
            totalRecords: records.total,
          };
        }
        throw error;
      }
    },
    enabled: !!selectedTable && !!apiKey,
    placeholderData: (previousData) => previousData, // Keep previous data while loading new sorted data
  });

  // Reset sorting flag when loading completes
  useEffect(() => {
    if (!isLoadingTable && isSorting) {
      setIsSorting(false);
    }
  }, [isLoadingTable, isSorting]);

  const filteredTables = useMemo(
    () =>
      metadata?.tables
        ? Object.fromEntries(
            Object.entries(metadata.tables).filter(([name]) => !name.startsWith('_'))
          )
        : {},
    [metadata?.tables]
  );

  // Auto-select first table (excluding system tables)
  useEffect(() => {
    if (metadata) {
      const tableNames = Object.keys(metadata.tables).filter((name) => !name.startsWith('_'));

      if (selectedTable && !tableNames.includes(selectedTable)) {
        setSelectedTable(null);
      }

      if (!selectedTable && tableNames.length > 0) {
        setSelectedTable(tableNames[0]);
      }
    }
  }, [metadata, selectedTable]);

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
      await refetchMetadata();
    } finally {
      setIsRefreshing(false);
    }
  };

  const handleCreateTable = () => {
    setEditingTable(null);
    setShowTableForm(true);
  };

  const handleEditTable = (tableName: string) => {
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
      try {
        // Update selectedTable BEFORE deleting to prevent queries on deleted table
        if (selectedTable === tableName) {
          setSelectedTable(null);
        }

        await databaseService.deleteTable(tableName);
        showToast('Table deleted successfully', 'success');

        // Invalidate all related queries for the deleted table
        void queryClient.invalidateQueries({ queryKey: ['metadata'] });
        void queryClient.invalidateQueries({ queryKey: ['tables'] });
        void queryClient.invalidateQueries({ queryKey: ['table', tableName] });
        void queryClient.invalidateQueries({ queryKey: ['table-schema', tableName] });
      } catch (error: any) {
        const errorMessage =
          error.response?.data?.error?.message || error.message || 'Failed to delete table';
        showToast(errorMessage, 'error');
      }
    }
  };

  // Handle record update
  const handleRecordUpdate = async (rowId: string, columnKey: string, newValue: any) => {
    if (!selectedTable) {
      return;
    }

    try {
      // Find column schema to determine the correct type conversion
      const columnSchema = tableData?.schema?.columns?.find((col: any) => col.name === columnKey);

      // Convert value based on column type using utility function
      let convertedValue: any = newValue;
      if (columnSchema) {
        const conversionResult = convertValueForColumn(columnSchema, newValue);
        if (!conversionResult.success) {
          showToast(conversionResult.error || 'Invalid value', 'error');
          return;
        }
        convertedValue = conversionResult.value;
      }

      const updates = { [columnKey]: convertedValue };
      await databaseService.updateRecord(selectedTable, rowId, updates);
      await refetchTableData();
      showToast('Record updated successfully', 'success');
    } catch (error) {
      showToast('Failed to update record', 'error');
      throw error;
    }
  };

  // Handle record delete
  const handleRecordDelete = async (id: string) => {
    if (!selectedTable) {
      return;
    }
    const shouldDelete = await confirm({
      title: 'Delete Record',
      description: 'Are you sure you want to delete this record? This action cannot be undone.',
      confirmText: 'Delete',
      destructive: true,
    });

    if (shouldDelete) {
      try {
        await databaseService.deleteRecord(selectedTable, id);
        await Promise.all([
          refetchTableData(),
          refetchMetadata(), // Also refresh metadata to update sidebar record counts
        ]);
        setSelectedRows((prev) => {
          const newSet = new Set(prev);
          newSet.delete(id);
          return newSet;
        });
        showToast('Record deleted successfully', 'success');
      } catch {
        showToast('Failed to delete record', 'error');
      }
    }
  };

  // Handle bulk delete
  const handleBulkDelete = async (ids: string[]) => {
    if (!selectedTable || ids.length === 0) {
      return;
    }

    const shouldDelete = await confirm({
      title: `Delete ${ids.length} ${ids.length === 1 ? 'Record' : 'Records'}`,
      description: `Are you sure you want to delete ${ids.length} ${ids.length === 1 ? 'record' : 'records'}? This action cannot be undone.`,
      confirmText: 'Delete',
      destructive: true,
    });

    if (shouldDelete) {
      try {
        await Promise.all(ids.map((id) => databaseService.deleteRecord(selectedTable, id)));
        await Promise.all([
          refetchTableData(),
          refetchMetadata(), // Also refresh metadata to update sidebar record counts
        ]);
        setSelectedRows(new Set());
        showToast(`${ids.length} records deleted successfully`, 'success');
      } catch {
        showToast('Failed to delete some records', 'error');
      }
    }
  };

  const error = metadataError || tableError;

  // Fetch schema for selected table
  const { data: schemaData } = useQuery({
    queryKey: ['table-schema', selectedTable],
    queryFn: async () => {
      if (!selectedTable) {
        return undefined;
      }
      return await databaseService.getTableSchema(selectedTable);
    },
    enabled: !!selectedTable && !!apiKey,
    staleTime: 30 * 1000, // 30 seconds
  });

  // Fetch schema for editing table
  const { data: editingTableSchema } = useQuery({
    queryKey: ['table-schema', editingTable],
    queryFn: async () => {
      if (!editingTable) {
        return undefined;
      }
      const editingTableSchema = await databaseService.getTableSchema(editingTable);
      return editingTableSchema;
    },
    enabled: !!editingTable && !!apiKey,
  });

  // Calculate pagination
  const totalPages = Math.ceil((tableData?.totalRecords || 0) / pageSize);

  return (
    <div className="flex h-[calc(100vh-4rem)] bg-[#f8f9fa]">
      {/* Secondary Sidebar - Table List */}
      <TableSidebar
        tables={filteredTables}
        selectedTable={selectedTable || undefined}
        onTableSelect={setSelectedTable}
        loading={isLoading}
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
                setShowTableForm(false);
                setEditingTable(null);
              }
            }}
            mode={editingTable ? 'edit' : 'create'}
            editTable={editingTable ? editingTableSchema : undefined}
            onSuccess={() => {
              void refetchMetadata();
              void refetchTableData();
              setShowTableForm(false);
              setEditingTable(null);
            }}
          />
        ) : (
          // Show normal content with header
          <>
            {/* Sticky Header Section */}
            {selectedTable && (
              <div className="sticky top-0 z-30 bg-[#f8f9fa]">
                <div className="px-6 py-3 border-b border-border-gray h-12">
                  {/* Page Header with Breadcrumb */}
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-3">
                      <nav className="flex items-center text-base font-semibold">
                        <span className="text-black">{selectedTable}</span>
                      </nav>

                      {/* Separator */}
                      <div className="h-6 w-px bg-gray-200" />

                      {/* Action buttons group */}
                      <div className="flex items-center gap-3">
                        <TooltipProvider>
                          <Tooltip>
                            <TooltipTrigger asChild>
                              <Button
                                variant="ghost"
                                size="icon"
                                className="h-5 w-5 text-zinc-500 hover:text-black"
                                onClick={() => handleEditTable(selectedTable)}
                              >
                                <img src={PencilIcon} alt="Pencil Icon" className="h-5 w-5" />
                              </Button>
                            </TooltipTrigger>
                            <TooltipContent side="bottom" align="center">
                              <p>Edit Table</p>
                            </TooltipContent>
                          </Tooltip>

                          <Tooltip>
                            <TooltipTrigger asChild>
                              <Button
                                variant="ghost"
                                size="icon"
                                className="h-5 w-5 text-zinc-500 hover:text-black"
                                onClick={() => void handleRefresh()}
                                disabled={isRefreshing}
                              >
                                <img src={RefreshIcon} alt="Refresh Icon" className="h-5 w-5" />
                              </Button>
                            </TooltipTrigger>
                            <TooltipContent side="bottom" align="center">
                              <p>{isRefreshing ? 'Refreshing...' : 'Refresh'}</p>
                            </TooltipContent>
                          </Tooltip>
                        </TooltipProvider>
                      </div>
                    </div>
                  </div>
                </div>

                <div className="px-6 py-3">
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
                          <Button
                            variant="outline"
                            className="h-10 px-3 text-sm text-red-600 hover:text-red-600 hover:bg-zinc-50 border border-border-gray shadow-none"
                            onClick={() => void handleBulkDelete(Array.from(selectedRows))}
                          >
                            Delete {selectedRows.size}{' '}
                            {selectedRows.size === 1 ? 'Record' : 'Records'}
                          </Button>
                        </div>
                      ) : (
                        <SearchInput
                          value={searchQuery}
                          onChange={setSearchQuery}
                          placeholder="Search Records by any Text Field"
                          className="flex-1 max-w-80"
                          debounceTime={300}
                        />
                      )}
                      <div className="flex items-center gap-2 ml-4">
                        {selectedRows.size === 0 && (
                          <>
                            {/* Add Record Button */}
                            <Button
                              className="h-10 px-4 font-medium gap-1.5"
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
                    image={EmptyDatabase}
                    title="No Table Selected"
                    description="Select a table from the sidebar to view its data"
                  />
                </div>
              ) : (
                <div className="flex-1 flex flex-col overflow-hidden bg-white border border-gray-200">
                  <DatabaseDataGrid
                    data={tableData?.records || []}
                    schema={tableData?.schema}
                    loading={isLoadingTable && !tableData} // Only show loading when no data exists
                    isSorting={isSorting}
                    isRefreshing={isRefreshing}
                    selectedRows={selectedRows}
                    onSelectedRowsChange={setSelectedRows}
                    sortColumns={sortColumns}
                    onSortColumnsChange={handleSortColumnsChange}
                    onCellEdit={handleRecordUpdate}
                    searchQuery={searchQuery}
                    currentPage={currentPage}
                    totalPages={totalPages}
                    pageSize={pageSize}
                    totalRecords={tableData?.totalRecords || 0}
                    onPageChange={setCurrentPage}
                    onDeleteRecord={(id) => void handleRecordDelete(id)}
                    onNewRecord={() => setShowRecordForm(true)}
                  />
                </div>
              )}
            </div>
          </>
        )}
      </div>

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
            void refetchMetadata();
            // Also invalidate the schema cache to ensure fresh data
            void queryClient.invalidateQueries({ queryKey: ['table-schema', selectedTable] });
          }}
        />
      )}

      {/* Confirm Dialog */}
      <ConfirmDialog {...ConfirmDialogProps} />
    </div>
  );
}
