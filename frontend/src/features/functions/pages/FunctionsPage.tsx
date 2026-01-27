import { ChevronRight } from 'lucide-react';
import { FunctionRow } from '../components/FunctionRow';
import FunctionEmptyState from '../components/FunctionEmptyState';
import { useFunctions } from '../hooks/useFunctions';
import { useToast } from '@/lib/hooks/useToast';
import { useEffect, useRef, useState } from 'react';
import RefreshIcon from '@/assets/icons/refresh.svg?react';
import {
  CodeEditor,
  Button,
  Skeleton,
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components';

export default function FunctionsPage() {
  const toastShownRef = useRef(false);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const { showToast } = useToast();
  const {
    functions,
    isRuntimeAvailable,
    selectedFunction,
    isLoading: loading,
    selectFunction,
    clearSelection,
    refetch,
    deploymentUrl,
  } = useFunctions();

  const handleRefresh = async () => {
    setIsRefreshing(true);
    try {
      await refetch();
    } finally {
      setIsRefreshing(false);
    }
  };

  useEffect(() => {
    if (!isRuntimeAvailable && !toastShownRef.current) {
      toastShownRef.current = true;
      showToast('Function container is unhealthy.', 'error');
    }
  }, [isRuntimeAvailable, showToast]);

  // If a function is selected, show the detail view
  if (selectedFunction) {
    return (
      <div className="h-full flex flex-col overflow-hidden">
        <div className="flex items-center gap-2.5 p-4 border-b border-border-gray dark:border-neutral-600">
          <button
            onClick={clearSelection}
            className="text-xl text-zinc-500 dark:text-neutral-400 hover:text-zinc-950 dark:hover:text-white transition-colors"
          >
            Functions
          </button>
          <ChevronRight className="w-5 h-5 text-muted-foreground dark:text-neutral-400" />
          <p className="text-xl text-zinc-950 dark:text-white">{selectedFunction.name}</p>
        </div>

        <div className="flex-1 min-h-0">
          <CodeEditor code={selectedFunction.code || '// No code available'} />
        </div>
      </div>
    );
  }

  // Default list view
  return (
    <div className="h-full flex flex-col overflow-hidden">
      <div className="flex flex-col gap-6 p-4">
        <div className="flex items-center gap-3">
          <h1 className="text-xl font-normal text-zinc-950 dark:text-white">Functions</h1>

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
        {/* Table Header */}
        <div className="grid grid-cols-12 px-3 text-sm text-muted-foreground dark:text-neutral-400">
          <div className="col-span-2 py-1 px-3">Name</div>
          <div className="col-span-6 py-1 px-3">URL</div>
          <div className="col-span-2 py-1 px-3">Created</div>
          <div className="col-span-2 py-1 px-3">Last Update</div>
        </div>
      </div>

      {/* Scrollable Table Body */}
      <div className="flex-1 min-h-0 overflow-y-auto px-4 pb-4 relative">
        <div className="flex flex-col gap-2">
          {loading ? (
            <>
              {[...Array(4)].map((_, i) => (
                <Skeleton key={i} className="h-14 rounded-[8px] cols-span-full" />
              ))}
            </>
          ) : functions.length >= 1 ? (
            <>
              {functions.map((func) => (
                <FunctionRow
                  key={func.id}
                  function={func}
                  onClick={() => void selectFunction(func)}
                  className="cols-span-full"
                  deploymentUrl={deploymentUrl}
                />
              ))}
            </>
          ) : (
            <div className="cols-span-full">
              <FunctionEmptyState />
            </div>
          )}
        </div>

        {/* Loading mask overlay */}
        {isRefreshing && (
          <div className="absolute inset-0 bg-white dark:bg-neutral-800 flex items-center justify-center z-50">
            <div className="flex items-center gap-1">
              <div className="w-5 h-5 border-2 border-zinc-500 dark:border-neutral-700 border-t-transparent rounded-full animate-spin" />
              <span className="text-sm text-zinc-500 dark:text-zinc-400">Loading</span>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
