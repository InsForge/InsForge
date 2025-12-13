import { useMemo, useState } from 'react';
import RefreshIcon from '@/assets/icons/refresh.svg?react';
import {
  Button,
  EmptyState,
  SearchInput,
  DataGrid,
  type DataGridColumn,
  type DataGridRowType,
  type ConvertedValue,
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components';
import { useFunctions } from '../hooks/useDatabase';
import { SQLModal, SQLCellButton } from '../components/SQLModal';
import type { DatabaseFunctionsResponse } from '@insforge/shared-schemas';

interface FunctionRow extends DataGridRowType {
  id: string;
  functionName: string;
  kind: string;
  functionDef: string;
  [key: string]: ConvertedValue | { [key: string]: string }[];
}

function parseFunctionsFromResponse(
  response: DatabaseFunctionsResponse | undefined
): FunctionRow[] {
  if (!response?.functions) {
    return [];
  }

  const functions: FunctionRow[] = [];

  response.functions.forEach((func) => {
    functions.push({
      id: func.functionName,
      functionName: func.functionName,
      kind: func.kind,
      functionDef: func.functionDef,
    });
  });

  return functions;
}

export default function FunctionsPage() {
  const [searchQuery, setSearchQuery] = useState('');
  const [isRefreshing, setIsRefreshing] = useState(false);
  const { data, isLoading, error, refetch } = useFunctions(true);
  const [sqlModal, setSqlModal] = useState({ open: false, title: '', value: '' });

  const allFunctions = useMemo(() => parseFunctionsFromResponse(data), [data]);

  const filteredFunctions = useMemo(() => {
    if (!searchQuery.trim()) {
      return allFunctions;
    }

    const query = searchQuery.toLowerCase();
    return allFunctions.filter((func) => func.functionName.toLowerCase().includes(query));
  }, [allFunctions, searchQuery]);

  const handleRefresh = async () => {
    setIsRefreshing(true);
    try {
      setSearchQuery('');
      await refetch();
    } finally {
      setIsRefreshing(false);
    }
  };

  const columns: DataGridColumn<FunctionRow>[] = useMemo(
    () => [
      {
        key: 'functionName',
        name: 'Name',
        width: 'minmax(200px, 2fr)',
        resizable: true,
        sortable: true,
      },
      {
        key: 'kind',
        name: 'Type',
        width: 'minmax(120px, 1fr)',
        resizable: true,
        sortable: true,
        renderCell: ({ row }) => {
          const kindLabel =
            row.kind === 'f' ? 'Function' : row.kind === 'p' ? 'Procedure' : row.kind;
          return (
            <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-gray-100 text-gray-800 dark:bg-gray-700 dark:text-gray-300">
              {kindLabel}
            </span>
          );
        },
      },
      {
        key: 'functionDef',
        name: 'Definition',
        width: 'minmax(400px, 8fr)',
        resizable: true,
        renderCell: ({ row }) => (
          <SQLCellButton
            value={row.functionDef}
            onClick={() =>
              setSqlModal({ open: true, title: 'Function Definition', value: row.functionDef })
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
          title="Failed to load functions"
          description={error instanceof Error ? error.message : 'An error occurred'}
        />
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-4 h-full p-4 bg-bg-gray dark:bg-neutral-800">
      <div className="flex items-center gap-3">
        <h1 className="text-xl font-normal text-zinc-950 dark:text-white">Database Functions</h1>

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
        placeholder="Search for a function"
        className="w-64"
      />

      {isLoading ? (
        <div className="flex-1 flex items-center justify-center">
          <EmptyState title="Loading functions..." description="Please wait" />
        </div>
      ) : (
        <div className="flex-1 overflow-hidden">
          <DataGrid
            data={filteredFunctions}
            columns={columns}
            showSelection={false}
            showPagination={false}
            noPadding={true}
            className="h-full"
            isRefreshing={isRefreshing}
            emptyState={
              <div className="text-sm text-zinc-500 dark:text-zinc-400">
                {searchQuery ? 'No functions match your search criteria' : 'No functions found'}
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
