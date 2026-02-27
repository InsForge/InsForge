import { useMemo, useState } from 'react';
import RefreshIcon from '@/assets/icons/refresh.svg?react';
import { Button, Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@insforge/ui';
import { useNavigate } from 'react-router-dom';
import {
  ConvertedValue,
  DataGrid,
  type DataGridColumn,
  type DataGridRowType,
  EmptyState,
  SearchInput,
  SortableHeaderRenderer,
} from '@/components';
import { useIndexes } from '../hooks/useDatabase';
import { SQLModal, SQLCellButton } from '../components/SQLModal';
import { DatabaseStudioMenuPanel } from '../components/DatabaseSecondaryMenu';
import type { DatabaseIndexesResponse } from '@insforge/shared-schemas';

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
  const navigate = useNavigate();
  const [searchQuery, setSearchQuery] = useState('');
  const [isRefreshing, setIsRefreshing] = useState(false);
  const { data, isLoading, error, refetch } = useIndexes(true);
  const [sqlModal, setSqlModal] = useState({ open: false, title: '', value: '' });

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

  const columns: DataGridColumn<IndexRow>[] = useMemo(
    () => [
      {
        key: 'tableName',
        name: 'Table',
        width: 'minmax(180px, 1.5fr)',
        resizable: true,
        sortable: true,
        renderHeaderCell: (props) => (
          <div className="flex h-full w-full items-center pl-2">
            <SortableHeaderRenderer
              column={props.column as DataGridColumn<IndexRow>}
              sortDirection={props.sortDirection}
            />
          </div>
        ),
        renderCell: ({ row }) => (
          <div className="flex h-full w-full items-center pl-2">
            <span className="truncate text-foreground" title={row.tableName}>
              {row.tableName}
            </span>
          </div>
        ),
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
    ],
    [setSqlModal]
  );

  if (error) {
    return (
      <div className="flex h-full min-h-0 overflow-hidden bg-[rgb(var(--semantic-1))]">
        <DatabaseStudioMenuPanel
          onBack={() =>
            void navigate('/dashboard/database/tables', { state: { slideFromStudio: true } })
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
      <DatabaseStudioMenuPanel
        onBack={() =>
          void navigate('/dashboard/database/tables', { state: { slideFromStudio: true } })
        }
      />
      <div className="min-w-0 flex-1 flex flex-col overflow-hidden bg-[rgb(var(--semantic-1))]">
        <div className="flex shrink-0 items-center justify-between border-b border-[var(--alpha-8)] bg-[rgb(var(--semantic-0))]">
          <div className="flex min-w-0 flex-1 items-center overflow-hidden pl-4 pr-3 py-3">
            <h1 className="shrink-0 text-base font-medium leading-7 text-foreground">
              Database Indexes
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
          </div>
          <div className="w-[280px] p-3">
            <SearchInput
              value={searchQuery}
              onChange={setSearchQuery}
              placeholder="Search index"
              className="w-full"
            />
          </div>
        </div>
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
                <div className="text-sm text-zinc-500 dark:text-zinc-400">
                  {searchQuery ? 'No indexes match your search criteria' : 'No indexes found'}
                </div>
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
