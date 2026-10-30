import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import RefreshIcon from '#assets/icons/refresh.svg?react';
import { Button, Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@insforge/ui';
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
import { useDatabaseSchemas, useIndexes } from '#features/database/hooks/useDatabase';
import { useDatabaseSchemaSelection } from '#features/database/hooks/useDatabaseSchemaSelection';
import { SQLModal, SQLCellButton } from '#features/database/components/SQLModal';
import { DatabaseStudioSidebarPanel } from '#features/database/components/DatabaseSidebar';
import { type DatabaseIndexesResponse } from '@insforge/shared-schemas';
import { DatabaseSchemaSelect } from '#features/database/components/DatabaseSchemaSelect';
import { usePageSize } from '#lib/hooks/usePageSize';
import { DEFAULT_DATABASE_SCHEMA, getDatabaseSchemaInfo } from '#features/database/helpers';

interface IndexRow extends DataGridRowType {
  id: string;
  tableName: string;
  indexName: string;
  indexDef: string;
  isUnique: boolean | null;
  isPrimary: boolean | null;
  [key: string]: ConvertedValue | { [key: string]: string }[];
}

function parseIndexesFromResponse(response: DatabaseIndexesResponse | undefined): IndexRow[] {
  if (!response?.indexes) {
    return [];
  }

  const indexes: IndexRow[] = [];

  response.indexes.forEach((index) => {
    indexes.push({
      id: `${index.tableName}_${index.indexName}`,
      tableName: index.tableName,
      indexName: index.indexName,
      indexDef: index.indexDef,
      isUnique: index.isUnique,
      isPrimary: index.isPrimary,
    });
  });

  return indexes;
}

export default function IndexesPage() {
  const { t } = useTranslation('chrome');
  const location = useLocation();
  const navigate = useNavigate();
  const { selectedSchema, setSelectedSchema } = useDatabaseSchemaSelection();
  const [searchQuery, setSearchQuery] = useState('');
  const [isRefreshing, setIsRefreshing] = useState(false);
  const { schemas, isLoading: isLoadingSchemas } = useDatabaseSchemas();
  const selectedSchemaInfo = getDatabaseSchemaInfo(schemas, selectedSchema);
  const { data, isLoading, error, refetch } = useIndexes(selectedSchema, true);
  const [sqlModal, setSqlModal] = useState({ open: false, title: '', value: '' });
  const { pageSize, pageSizeOptions, onPageSizeChange } = usePageSize('db-indexes');
  const [currentPage, setCurrentPage] = useState(1);

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

  const totalPages = Math.ceil(filteredIndexes.length / pageSize);
  const safeCurrentPage = Math.min(currentPage, Math.max(1, totalPages));

  const paginatedIndexes = useMemo(() => {
    const start = (safeCurrentPage - 1) * pageSize;
    return filteredIndexes.slice(start, start + pageSize);
  }, [filteredIndexes, safeCurrentPage, pageSize]);

  useEffect(() => {
    setCurrentPage(1);
  }, [searchQuery, selectedSchema, pageSize]);

  const handleRefresh = async () => {
    setIsRefreshing(true);
    try {
      setSearchQuery('');
      setCurrentPage(1);
      await refetch();
    } finally {
      setIsRefreshing(false);
    }
  };

  const columns: DataGridColumn<IndexRow>[] = useMemo(
    () => [
      {
        key: 'tableName',
        name: t('database.tableColumn', { defaultValue: 'Table' }),
        width: 'minmax(180px, 1.5fr)',
        resizable: true,
        sortable: true,
      },
      {
        key: 'indexName',
        name: t('common.nameColumn', { defaultValue: 'Name' }),
        width: 'minmax(200px, 2fr)',
        resizable: true,
        sortable: true,
      },
      {
        key: 'isPrimary',
        name: t('common.typeColumn', { defaultValue: 'Type' }),
        width: 'minmax(120px, 1fr)',
        resizable: true,
        sortable: true,
        renderCell: ({ row }) => {
          if (row.isPrimary) {
            return (
              <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-gray-100 text-gray-800 dark:bg-gray-700 dark:text-gray-300">
                {t('database.primaryIndex', { defaultValue: 'Primary' })}
              </span>
            );
          }
          if (row.isUnique) {
            return (
              <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-gray-100 text-gray-800 dark:bg-gray-700 dark:text-gray-300">
                {t('database.uniqueIndex', { defaultValue: 'Unique' })}
              </span>
            );
          }
          return (
            <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-gray-100 text-gray-800 dark:bg-gray-700 dark:text-gray-300">
              {t('database.indexBadge', { defaultValue: 'Index' })}
            </span>
          );
        },
      },
      {
        key: 'indexDef',
        name: t('database.definitionColumn', { defaultValue: 'Definition' }),
        width: 'minmax(300px, 5fr)',
        resizable: true,
        renderCell: ({ row }) => (
          <SQLCellButton
            value={row.indexDef}
            onClick={() =>
              setSqlModal({
                open: true,
                title: t('database.indexDefinition', { defaultValue: 'Index Definition' }),
                value: row.indexDef,
              })
            }
          />
        ),
      },
    ],
    [setSqlModal, t]
  );

  useEffect(() => {
    if (isLoadingSchemas || schemas.length === 0) {
      return;
    }

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
          <p>
            {isRefreshing
              ? t('common.refreshing', { defaultValue: 'Refreshing...' })
              : t('database.refreshIndexes', { defaultValue: 'Refresh indexes' })}
          </p>
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
              {
                pathname: '/dashboard/database/tables',
                search: location.search,
              },
              { state: { slideFromStudio: true } }
            )
          }
        />
        <div className="min-w-0 flex-1 flex items-center justify-center bg-[rgb(var(--semantic-1))]">
          <EmptyState
            title={t('database.failedToLoadIndexes', { defaultValue: 'Failed to load indexes' })}
            description={
              error instanceof Error
                ? error.message
                : t('common.anErrorOccurred', { defaultValue: 'An error occurred' })
            }
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
            {
              pathname: '/dashboard/database/tables',
              search: location.search,
            },
            { state: { slideFromStudio: true } }
          )
        }
      />
      <div className="min-w-0 flex-1 flex flex-col overflow-hidden bg-[rgb(var(--semantic-1))]">
        <TableHeader
          title={t('database.databaseIndexes', { defaultValue: 'Database Indexes' })}
          showDividerAfterTitle
          titleButtons={
            <div className="w-56">
              <DatabaseSchemaSelect
                schemas={schemas}
                value={selectedSchemaInfo.name}
                onValueChange={(schemaName) => {
                  setSearchQuery('');
                  setCurrentPage(1);
                  setSelectedSchema(schemaName, { replace: true });
                }}
                disabled={isLoadingSchemas}
              />
            </div>
          }
          leftSlot={refreshButton}
          searchValue={searchQuery}
          onSearchChange={setSearchQuery}
          searchPlaceholder={t('database.searchIndex', { defaultValue: 'Search index' })}
        />
        {isLoading ? (
          <div className="min-h-0 flex-1 flex items-center justify-center">
            <EmptyState
              title={t('database.loadingIndexes', { defaultValue: 'Loading indexes...' })}
              description={t('common.pleaseWait', { defaultValue: 'Please wait' })}
            />
          </div>
        ) : (
          <div className="min-h-0 flex-1 overflow-hidden">
            <DataGrid
              data={paginatedIndexes}
              columns={columns}
              showSelection={false}
              showPagination={true}
              currentPage={currentPage}
              totalPages={totalPages}
              pageSize={pageSize}
              pageSizeOptions={pageSizeOptions}
              totalRecords={filteredIndexes.length}
              paginationRecordLabel={t('database.indexesRecordLabel', { defaultValue: 'indexes' })}
              onPageChange={setCurrentPage}
              onPageSizeChange={onPageSizeChange}
              noPadding={true}
              className="h-full"
              isRefreshing={isRefreshing}
              emptyState={
                <DataGridEmptyState
                  message={
                    searchQuery
                      ? t('database.noIndexesMatchSearch', {
                          defaultValue: 'No indexes match your search criteria',
                        })
                      : t('database.noIndexesFound', { defaultValue: 'No indexes found' })
                  }
                />
              }
            />
          </div>
        )}

        {/* SQL Detail Modal */}
        <SQLModal
          open={sqlModal.open}
          onOpenChange={(open) => setSqlModal((prev) => ({ ...prev, open }))}
          title={sqlModal.title}
          value={sqlModal.value}
        />
      </div>
    </div>
  );
}
