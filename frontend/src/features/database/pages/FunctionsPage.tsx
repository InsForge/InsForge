import { useMemo, useState } from 'react';
import RefreshIcon from '@/assets/icons/refresh.svg?react';
import { Button, Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@insforge/ui';
import { useNavigate } from 'react-router-dom';
import {
  DataGridEmptyState,
  EmptyState,
  DataGrid,
  type DataGridColumn,
  type DataGridRowType,
  type ConvertedValue,
  TableHeader,
} from '@/components';
import { useFunctions } from '../hooks/useDatabase';
import { SQLModal, SQLCellButton } from '../components/SQLModal';
import { DatabaseStudioMenuPanel } from '../components/DatabaseSecondaryMenu';
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
  const navigate = useNavigate();
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
      <div className="flex h-full min-h-0 overflow-hidden bg-[rgb(var(--semantic-1))]">
        <DatabaseStudioMenuPanel
          onBack={() =>
            void navigate('/dashboard/database/tables', { state: { slideFromStudio: true } })
          }
        />
        <div className="min-w-0 flex-1 flex items-center justify-center bg-[rgb(var(--semantic-1))]">
          <EmptyState
            title="Failed to load functions"
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
        <TableHeader
          title="Database Functions"
          showDividerAfterTitle
          titleButtons={
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
                  <p>{isRefreshing ? 'Refreshing...' : 'Refresh functions'}</p>
                </TooltipContent>
              </Tooltip>
            </TooltipProvider>
          }
          searchValue={searchQuery}
          onSearchChange={setSearchQuery}
          searchPlaceholder="Search function"
        />
        {isLoading ? (
          <div className="min-h-0 flex-1 flex items-center justify-center">
            <EmptyState title="Loading functions..." description="Please wait" />
          </div>
        ) : (
          <div className="min-h-0 flex-1 overflow-hidden">
            <DataGrid
              data={filteredFunctions}
              columns={columns}
              showSelection={false}
              showPagination={false}
              noPadding={true}
              className="h-full"
              isRefreshing={isRefreshing}
              emptyState={
                <DataGridEmptyState
                  message={
                    searchQuery ? 'No functions match your search criteria' : 'No functions found'
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
