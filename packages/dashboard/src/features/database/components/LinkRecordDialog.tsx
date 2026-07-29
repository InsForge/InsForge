import { useState, useEffect, useMemo, useCallback, ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import {
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  SearchInput,
} from '@insforge/ui';
import {
  DataGrid,
  DataGridEmptyState,
  TypeBadge,
  type CellClickArgs,
  type RenderCellProps,
  type RenderHeaderCellProps,
  type SortColumn,
  SortableHeaderRenderer,
  type DatabaseRecord,
  type ConvertedValue,
  type DataGridRowType,
} from '#components';
import { useTables } from '#features/database/hooks/useTables';
import { useRecords } from '#features/database/hooks/useRecords';
import { useUsers } from '#features/auth/hooks/useUsers';
import { convertSchemaToColumns } from './DatabaseDataGrid';
import { formatValueForDisplay } from '#lib/utils/utils';
import { ColumnType } from '@insforge/shared-schemas';
import { AUTH_USERS_TABLE, authUsersSchema } from '#features/database/constants';
import { getPrimaryKeyColumns, parseDatabaseTableReference } from '#features/database/helpers';

const PAGE_SIZE = 50;

// Non-printable delimiter that cannot appear in PG text values
const ROW_KEY_DELIMITER = '\x00';

interface LinkRecordDialogProps {
  referenceTable: string;
  fkColumns: { sourceColumn: string; referenceColumn: string }[];
  onSelectRecord: (record: DatabaseRecord) => void;
  children: (openDialog: () => void) => ReactNode;
}

export function LinkRecordDialog({
  referenceTable,
  fkColumns,
  onSelectRecord,
  children,
}: LinkRecordDialogProps) {
  const { t } = useTranslation('chrome');
  const [open, setOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedRecord, setSelectedRecord] = useState<DatabaseRecord | null>(null);
  const [sortColumns, setSortColumns] = useState<SortColumn[]>([]);
  const [currentPage, setCurrentPage] = useState(1);
  const isAuthUsers = referenceTable === AUTH_USERS_TABLE;
  const { schemaName, tableName } = parseDatabaseTableReference(referenceTable);
  const { useTableSchema } = useTables(schemaName);

  // Regular table records hook (disabled for auth.users)
  const recordsHook = useRecords(isAuthUsers ? '' : tableName, schemaName);

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
  const { data: fetchedSchema } = useTableSchema(tableName, schemaName, !isAuthUsers && open);
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

  // Determine PK columns for stable row key derivation. auth.users is keyed by id;
  // DB tables reuse the shared PK helper (full composite key, falling back to id).
  const pkColumns = useMemo(
    () => (isAuthUsers ? ['id'] : getPrimaryKeyColumns(fetchedSchema?.columns)),
    [isAuthUsers, fetchedSchema]
  );

  // Build a stable encoded key from a record's PK column values.
  // Uses \x00 as delimiter since PG text cannot contain null bytes.
  const getRowKey = useCallback(
    (record: DatabaseRecord): string => {
      return pkColumns.map((col) => String(record[col] ?? '')).join(ROW_KEY_DELIMITER);
    },
    [pkColumns]
  );

  // Combine data from either source
  const recordsData = useMemo(() => {
    if (isAuthUsers) {
      return users.length > 0 || open
        ? {
            schema: authUsersSchema,
            records: users as DatabaseRecord[],
            totalRecords: totalUsers,
          }
        : undefined;
    }
    return schema && recordsResponse
      ? {
          schema,
          records: recordsResponse.records,
          totalRecords:
            recordsResponse.pagination.total ??
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

  // Create selected rows set using stable PK-derived keys
  const selectedRows = useMemo(() => {
    if (!selectedRecord) {
      return new Set<string>();
    }
    return new Set([getRowKey(selectedRecord)]);
  }, [selectedRecord, getRowKey]);

  // Handle cell click to select record
  const handleCellClick = useCallback((args: CellClickArgs<DataGridRowType>) => {
    setSelectedRecord(args.row as DatabaseRecord);
  }, []);

  // Convert schema to columns for the DataGrid with visual distinction
  const columns = useMemo(() => {
    const cols = convertSchemaToColumns(schema);
    return cols.map((col) => {
      const baseCol = {
        ...col,
        width: 210,
        minWidth: 210,
        resizable: true,
        editable: false,
      };

      // Helper function to render cell value properly based on type
      const renderCellValue = (
        value: ConvertedValue | { [key: string]: string }[],
        type: ColumnType | undefined
      ): string => {
        if (type === ColumnType.JSON && value !== null && typeof value === 'object') {
          return formatValueForDisplay(JSON.stringify(value), type);
        }
        return formatValueForDisplay(value as ConvertedValue, type);
      };

      return {
        ...baseCol,
        renderCell: (props: RenderCellProps<DataGridRowType>) => {
          const displayValue = renderCellValue(props.row[col.key], col.type);
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
    });
  }, [schema]);

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
        <DialogContent className="flex h-[min(90dvh,760px)] flex-col overflow-hidden">
          <DialogHeader className="flex-shrink-0">
            <DialogTitle>{t('database.linkRecord', { defaultValue: 'Link Record' })}</DialogTitle>
            <DialogDescription className="sr-only">
              {t('database.linkRecordDescription', {
                defaultValue: 'Select a record to link as a reference',
              })}
            </DialogDescription>
            <div className="flex items-center gap-1.5">
              <span className="text-sm text-zinc-500 dark:text-neutral-400">
                {t('database.selectRecordToReference', {
                  defaultValue: 'Select a record to reference from',
                })}
              </span>
              <TypeBadge
                type={`${referenceTable}.${fkColumns.map((c) => c.referenceColumn).join(',')}`}
                className="dark:bg-neutral-700"
              />
            </div>
          </DialogHeader>

          {/* Search Bar */}
          <div className="flex-shrink-0 p-3">
            <SearchInput
              value={searchQuery}
              onChange={setSearchQuery}
              placeholder={t('database.searchRecords', { defaultValue: 'Search records...' })}
              className="w-60 dark:text-white dark:bg-neutral-900 dark:border-neutral-700"
              debounceTime={300}
            />
          </div>

          {/* Records DataGrid */}
          <div className="flex-1 min-h-0 overflow-hidden max-h-[calc(100dvh-260px)]">
            <DataGrid
              data={records}
              columns={columns}
              loading={isLoading && !records.length}
              rowKeyGetter={getRowKey}
              selectedRows={selectedRows}
              onSelectedRowsChange={(newSelectedRows) => {
                const selectedId = Array.from(newSelectedRows)[0];
                if (selectedId) {
                  const record = records.find((r) => getRowKey(r) === selectedId);
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
                <DataGridEmptyState
                  message={
                    searchQuery
                      ? t('database.noRecordsMatchSearch', {
                          defaultValue: 'No records match your search criteria',
                        })
                      : t('database.noRecordsFound', { defaultValue: 'No records found' })
                  }
                />
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
              {t('common.cancel', { defaultValue: 'Cancel' })}
            </Button>
            <Button
              onClick={handleConfirmSelection}
              disabled={!selectedRecord}
              className="bg-zinc-950 hover:bg-zinc-800 text-white dark:bg-emerald-300 dark:text-zinc-950 dark:hover:bg-emerald-400"
            >
              {t('database.addRecord', { defaultValue: 'Add Record' })}
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
