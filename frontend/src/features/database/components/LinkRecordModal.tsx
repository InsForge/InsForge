import { useState, useEffect, useMemo, useCallback, ReactNode } from 'react';
import {
  Button,
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  SearchInput,
  DataGrid,
  TypeBadge,
  type CellMouseEvent,
  type CellClickArgs,
  type RenderCellProps,
  type RenderHeaderCellProps,
  type SortColumn,
  SortableHeaderRenderer,
  type DatabaseRecord,
  type ConvertedValue,
  type DataGridRowType,
} from '@/components';
import { useTables } from '@/features/database/hooks/useTables';
import { useRecords } from '@/features/database/hooks/useRecords';
import { useUsers } from '@/features/auth/hooks/useUsers';
import { convertSchemaToColumns } from '@/features/database/components/DatabaseDataGrid';
import { formatValueForDisplay } from '@/lib/utils/utils';
import { ColumnType } from '@insforge/shared-schemas';
import { AUTH_USERS_TABLE, authUsersSchema } from '../constants';

const PAGE_SIZE = 50;

interface LinkRecordModalProps {
  referenceTable: string;
  referenceColumn: string;
  onSelectRecord: (record: DatabaseRecord) => void;
  children: (openModal: () => void) => ReactNode;
}

export function LinkRecordModal({
  referenceTable,
  referenceColumn,
  onSelectRecord,
  children,
}: LinkRecordModalProps) {
  const [open, setOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedRecord, setSelectedRecord] = useState<DatabaseRecord | null>(null);
  const [sortColumns, setSortColumns] = useState<SortColumn[]>([]);
  const [currentPage, setCurrentPage] = useState(1);
  const { useTableSchema } = useTables();
  const isAuthUsers = referenceTable === AUTH_USERS_TABLE;

  // Regular table records hook (disabled for auth.users)
  const recordsHook = useRecords(isAuthUsers ? '' : referenceTable);

  // Auth users hook
  const {
    users,
    totalUsers,
    isLoading: isLoadingUsers,
    setCurrentPage: setUsersCurrentPage,
  } = useUsers({
    pageSize: PAGE_SIZE,
    enabled: isAuthUsers && open,
    searchQuery: isAuthUsers ? searchQuery : '',
  });

  // Sync current page with users hook
  useEffect(() => {
    if (isAuthUsers) {
      setUsersCurrentPage(currentPage);
    }
  }, [currentPage, isAuthUsers, setUsersCurrentPage]);

  // Fetch table schema (skip for auth.users)
  const { data: fetchedSchema } = useTableSchema(referenceTable, !isAuthUsers && open);
  const schema = isAuthUsers ? authUsersSchema : fetchedSchema;

  // Fetch records from the reference table (skip for auth.users)
  const offset = (currentPage - 1) * PAGE_SIZE;
  const { data: recordsResponse, isLoading: isLoadingRecords } = recordsHook.useTableRecords(
    PAGE_SIZE,
    offset,
    searchQuery || undefined,
    sortColumns,
    !isAuthUsers && open
  );

  // Combine data from either source
  const recordsData = useMemo(() => {
    if (isAuthUsers) {
      return users.length > 0 || open
        ? {
            schema: authUsersSchema,
            records: users as unknown as DatabaseRecord[],
            totalRecords: totalUsers,
          }
        : undefined;
    }
    return schema && recordsResponse
      ? {
          schema,
          records: recordsResponse.records,
          totalRecords:
            recordsResponse.pagination.total ||
            ('recordCount' in schema ? (schema.recordCount as number) : 0),
        }
      : undefined;
  }, [isAuthUsers, users, totalUsers, open, schema, recordsResponse]);

  const isLoading = isAuthUsers ? isLoadingUsers : isLoadingRecords;

  // Reset page when search query changes
  useEffect(() => {
    setCurrentPage(1);
  }, [searchQuery]);

  const records = useMemo(
    (): DataGridRowType[] => recordsData?.records || [],
    [recordsData?.records]
  );
  const totalRecords = recordsData?.totalRecords || 0;
  const totalPages = Math.ceil(totalRecords / PAGE_SIZE);

  // Create selected rows set for highlighting
  const selectedRows = useMemo(() => {
    if (!selectedRecord) {
      return new Set<string>();
    }
    return new Set([String(selectedRecord.id || '')]);
  }, [selectedRecord]);

  // Handle cell click to select record - only for reference column
  const handleCellClick = useCallback(
    (args: CellClickArgs<DataGridRowType>, event: CellMouseEvent) => {
      // Only allow selection when clicking on the reference column
      if (args.column.key !== referenceColumn) {
        // Prevent the default selection behavior for non-reference columns
        event?.preventDefault();
        event?.stopPropagation();
        return;
      }

      const record = records.find((r: DatabaseRecord) => String(r.id) === String(args.row.id));
      if (record) {
        setSelectedRecord(record);
      }
    },
    [records, referenceColumn]
  );

  // Convert schema to columns for the DataGrid with visual distinction
  const columns = useMemo(() => {
    const cols = convertSchemaToColumns(schema);
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
      const renderCellValue = (value: ConvertedValue, type: ColumnType | undefined) => {
        return formatValueForDisplay(value, type);
      };

      if (col.key === referenceColumn) {
        return {
          ...baseCol,
          renderCell: (props: RenderCellProps<DataGridRowType>) => {
            const displayValue = renderCellValue(String(props.row[col.key]), col.type);
            return (
              <div className="w-full h-full flex items-center cursor-pointer">
                <span className="truncate font-medium" title={displayValue}>
                  {displayValue}
                </span>
              </div>
            );
          },
          renderHeaderCell: (props: RenderHeaderCellProps<DataGridRowType>) => (
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
        renderCell: (props: RenderCellProps<DataGridRowType>) => {
          const displayValue = renderCellValue(String(props.row[col.key]), col.type);
          return (
            <div className="w-full h-full flex items-center cursor-not-allowed relative">
              <div className="absolute inset-0 pointer-events-none opacity-0 hover:opacity-10 bg-gray-200 dark:bg-gray-600 transition-opacity z-5" />
              <span className="truncate dark:text-zinc-300 opacity-70" title={displayValue}>
                {displayValue}
              </span>
            </div>
          );
        },
        renderHeaderCell: (props: RenderHeaderCellProps<DataGridRowType>) => (
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
  }, [schema, referenceColumn]);

  const handleConfirmSelection = () => {
    if (selectedRecord) {
      onSelectRecord(selectedRecord);
      setOpen(false);
    }
  };

  const handleCancel = () => {
    setOpen(false);
  };

  return (
    <>
      {children(() => setOpen(true))}
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-4xl h-[calc(100vh-48px)] p-0 gap-0 flex flex-col">
          <DialogHeader className="px-6 py-3 border-b border-zinc-200 dark:border-neutral-700 flex-shrink-0 flex flex-col gap-1">
            <DialogTitle className="text-lg font-semibold text-zinc-950 dark:text-white">
              Link Record
            </DialogTitle>
            <div className="flex items-center gap-1.5">
              <span className="text-sm text-zinc-500 dark:text-neutral-400">
                Select a record to reference from
              </span>
              <TypeBadge
                type={`${referenceTable}.${referenceColumn}`}
                className="dark:bg-neutral-700"
              />
            </div>
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
                // Handle selection changes from cell clicks
                const selectedId = Array.from(newSelectedRows)[0];
                if (selectedId) {
                  const record = records.find((r: DatabaseRecord) => String(r.id) === selectedId);
                  if (record) {
                    setSelectedRecord(record);
                  }
                } else {
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
              emptyState={
                <div className="flex flex-col items-center justify-center h-full">
                  <p className="text-neutral-500 dark:text-neutral-400 select-none">
                    {searchQuery ? 'No records match your search criteria' : 'No records found'}
                  </p>
                </div>
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
    </>
  );
}
