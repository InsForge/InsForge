import { useMemo, useState } from 'react';
import RefreshIcon from '@/assets/icons/refresh.svg?react';
import {
  Button,
  ConvertedValue,
  DataGrid,
  type DataGridColumn,
  type DataGridRowType,
  EmptyState,
  SearchInput,
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components';
import { useIndexes } from '../hooks/useDatabase';
import { SQLModal, SQLCellButton } from '../components/SQLModal';
import type { DatabaseIndexesResponse } from '@insforge/shared-schemas';
import { isSystemTable } from '../constants';

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
    if (isSystemTable(index.tableName)) {
      return;
    }

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
      <div className="flex-1 flex items-center justify-center">
        <EmptyState
          title="Failed to load indexes"
          description={error instanceof Error ? error.message : 'An error occurred'}
        />
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-4 h-full p-4 bg-bg-gray dark:bg-neutral-800">
      <div className="flex items-center gap-3">
        <h1 className="text-xl font-normal text-zinc-950 dark:text-white">Database Indexes</h1>

        {/* Separator */}
        <div className="h-6 w-px bg-gray-200 dark:bg-neutral-700" />

        {/* Refresh button */}
        <TooltipProvider>
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
        </TooltipProvider>
      </div>

      <SearchInput
        value={searchQuery}
        onChange={setSearchQuery}
        placeholder="Search for an index"
        className="w-64"
      />

      {isLoading ? (
        <div className="flex-1 flex items-center justify-center">
          <EmptyState title="Loading indexes..." description="Please wait" />
        </div>
      ) : (
        <div className="flex-1 overflow-hidden">
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
  );
}
