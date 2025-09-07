import { useState, useEffect, useMemo, useCallback } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/radix/Dialog';
import { Button } from '@/components/radix/Button';
import { databaseService } from '@/features/database/services/database.service';
import { convertSchemaToColumns } from '@/features/database/components/DatabaseDataGrid';
import { SortableHeaderRenderer } from '@/components/DataGrid';
import { SearchInput, DataGrid, TypeBadge } from '@/components';
import {
  type CellMouseEvent,
  type CellClickArgs,
  type RenderCellProps,
  type RenderHeaderCellProps,
  type SortColumn,
} from 'react-data-grid';
import { formatValueForDisplay } from '@/lib/utils/utils';
import { ColumnType } from '@insforge/shared-schemas';
import type { DataGridColumn, DataGridRow, DatabaseValue } from '@/lib/types/datagridTypes';

const PAGE_SIZE = 50;

interface LinkRecordModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  referenceTable: string;
  referenceColumn: string;
  onSelectRecord: (record: DataGridRow) => void;
  currentValue?: string | null;
}

export function LinkRecordModal({
  open,
  onOpenChange,
  referenceTable,
  referenceColumn,
  onSelectRecord,
}: LinkRecordModalProps) {
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedRecord, setSelectedRecord] = useState<DataGridRow | null>(null);
  const [sortColumns, setSortColumns] = useState<SortColumn[]>([]);
  const [currentPage, setCurrentPage] = useState(1);
  
  // Fetch records from the reference table
  const { data: recordsData, isLoading } = useQuery({
    queryKey: [
      'table',
      referenceTable,
      currentPage,
      PAGE_SIZE,
      searchQuery,
      JSON.stringify(sortColumns),
    ],
    queryFn: async () => {
      const offset = (currentPage - 1) * PAGE_SIZE;
      const [schema, records] = await Promise.all([
        databaseService.getTableSchema(referenceTable),
        databaseService.getTableRecords(
          referenceTable,
          PAGE_SIZE,
          offset,
          searchQuery || undefined,
          sortColumns
        ),
      ]);

      return {
        schema,
        records: records.records,
        totalRecords: schema.recordCount,
      };
    },
    enabled: open,
  });

  // Reset page when search query changes
  useEffect(() => {
    setCurrentPage(1);
  }, [searchQuery]);

  const records = useMemo(() => recordsData?.records || [], [recordsData?.records]);
  const totalRecords = recordsData?.totalRecords || 0;
  const totalPages = Math.ceil(totalRecords / PAGE_SIZE);

  // Create selected rows set for highlighting
  const selectedRows = useMemo(() => {
    if (!selectedRecord) {
      return new Set<string>();
    }
    return new Set([selectedRecord.id]);
  }, [selectedRecord]);

  // Handle cell click to select record - only for reference column
  const handleCellClick = useCallback(
    (args: CellClickArgs<DataGridRow>, event: CellMouseEvent) => {
      // Only allow selection when clicking on the reference column
      if (args.column.key !== referenceColumn) {
        // Prevent the default selection behavior for non-reference columns
        event?.preventDefault();
        event?.stopPropagation();
        return;
      }

      const record = records.find((r: DataGridRow) => r.id === args.row.id);
      if (record) {
        setSelectedRecord(record);
      }
    },
    [records, referenceColumn]
  );

  // Convert schema to columns for the DataGrid with visual distinction
  const columns = useMemo(() => {
    const cols: DataGridColumn[] = convertSchemaToColumns(recordsData?.schema);
    // Add visual indication for the reference column (clickable column)
    return cols.map((col) => {
      const baseCol = {
        ...col,
        width: 210,
        minWidth: 210,
        resizable: true,
        editable: false,
      };

      // Helper function to render cell value properly based on type
      const renderCellValue = (value: DatabaseValue, type: ColumnType | undefined) => {
        return formatValueForDisplay(value, type);
      };

      if (col.key === referenceColumn) {
        return {
          ...baseCol,
          renderCell: (props: RenderCellProps<DataGridRow>) => {
            const displayValue = renderCellValue(props.row[col.key], col.type);
            return (
              <div className="w-full h-full flex items-center cursor-pointer">
                <span className="truncate font-medium" title={displayValue}>
                  {displayValue}
                </span>
              </div>
            );
          },
          renderHeaderCell: (props: RenderHeaderCellProps<DataGridRow>) => (
            <SortableHeaderRenderer
              column={col}
              sortDirection={props.sortDirection}
              columnType={col.type}
              showTypeBadge={true}
              mutedHeader={false}
            />
          ),
        };
      }

      return {
        ...baseCol,
        cellClass: 'link-modal-disabled-cell',
        renderCell: (props: RenderCellProps<DataGridRow>) => {
          const displayValue = renderCellValue(props.row[col.key], col.type);
          return (
            <div className="w-full h-full flex items-center cursor-not-allowed relative">
              <div className="absolute inset-0 pointer-events-none opacity-0 hover:opacity-10 bg-gray-200 dark:bg-gray-600 transition-opacity z-5" />
              <span className="truncate dark:text-zinc-300 opacity-70" title={displayValue}>
                {displayValue}
              </span>
            </div>
          );
        },
        renderHeaderCell: (props: RenderHeaderCellProps<DataGridRow>) => (
          <SortableHeaderRenderer
            column={col}
            sortDirection={props.sortDirection}
            columnType={col.type}
            showTypeBadge={true}
            mutedHeader={true}
          />
        ),
      };
    });
  }, [recordsData?.schema, referenceColumn]);

  const handleConfirmSelection = () => {
    if (selectedRecord) {
      onSelectRecord(selectedRecord);
      onOpenChange(false);
    }
  };

  const handleCancel = () => {
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-4xl h-[calc(100vh-48px)] p-0 gap-0 flex flex-col">
        <DialogHeader className="px-6 py-3 border-b border-zinc-200 dark:border-neutral-700 flex-shrink-0 flex flex-col gap-1">
          <DialogTitle className="text-lg font-semibold text-zinc-950 dark:text-white">
            Link Record
          </DialogTitle>
          <p className="text-sm text-zinc-500 dark:text-neutral-400 flex items-center gap-1.5">
            Select a record to reference from
            <TypeBadge
              type={`${referenceTable}.${referenceColumn}`}
              className="dark:bg-neutral-700"
            />
          </p>
        </DialogHeader>

        {/* Search Bar */}
        <div className="p-3">
          <SearchInput
            value={searchQuery}
            onChange={setSearchQuery}
            placeholder="Search records..."
            className="w-60 dark:text-white dark:bg-neutral-900 dark:border-neutral-700"
            debounceTime={300}
          />
        </div>

        {/* Records DataGrid */}
        <div className="flex-1 overflow-hidden">
          <DataGrid
            data={records}
            columns={columns}
            loading={isLoading && !records.length}
            selectedRows={selectedRows}
            onSelectedRowsChange={(newSelectedRows) => {
              // Only allow selection changes if they come from valid interactions
              // This helps prevent programmatic selection of disabled rows
              const selectedId = Array.from(newSelectedRows)[0];
              if (selectedId && selectedRecord?.id !== selectedId) {
                const record = records.find((r: DataGridRow) => r.id === selectedId);
                if (record) {
                  setSelectedRecord(record);
                }
              } else if (!selectedId) {
                setSelectedRecord(null);
              }
            }}
            sortColumns={sortColumns}
            onSortColumnsChange={setSortColumns}
            onCellClick={handleCellClick}
            currentPage={currentPage}
            totalPages={totalPages}
            pageSize={PAGE_SIZE}
            totalRecords={totalRecords}
            onPageChange={setCurrentPage}
            showSelection={false}
            showPagination={true}
            emptyStateTitle="No records found"
            emptyStateDescription={
              searchQuery
                ? 'No records match your search criteria'
                : 'This table contains no records'
            }
          />
        </div>

        {/* Footer */}
        <div className="px-6 py-4 border-t border-zinc-200 dark:border-neutral-700 flex justify-end gap-3 flex-shrink-0">
          <Button
            variant="outline"
            onClick={handleCancel}
            className="dark:bg-neutral-600 dark:text-white dark:border-transparent dark:hover:bg-neutral-700"
          >
            Cancel
          </Button>
          <Button
            onClick={handleConfirmSelection}
            disabled={!selectedRecord}
            className="bg-zinc-950 hover:bg-zinc-800 text-white dark:bg-emerald-300 dark:text-zinc-950 dark:hover:bg-emerald-400"
          >
            Add Record
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
