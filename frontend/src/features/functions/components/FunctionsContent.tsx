import { ChevronRight } from 'lucide-react';
import { Skeleton } from '@/components/radix/Skeleton';
import { FunctionRow } from './FunctionRow';
import { CodeEditor } from '@/components/CodeEditor';
import FunctionEmptyState from './FunctionEmptyState';
import { useFunctions } from '../hooks/useFunctions';
import { useToast } from '@/lib/hooks/useToast';
import { useEffect, useRef } from 'react';

export function FunctionsContent() {
  const toastShownRef = useRef(false);
  const { showToast } = useToast();
  const {
    functions,
    isRuntimeAvailable,
    selectedFunction,
    isLoading: loading,
    selectFunction,
    clearSelection,
  } = useFunctions();

  useEffect(() => {
    if (!isRuntimeAvailable && !toastShownRef.current) {
      toastShownRef.current = true;
      showToast('Function container is unhealthy.', 'error');
    }
  }, [isRuntimeAvailable, showToast]);

  // If a function is selected, show the detail view
  if (selectedFunction) {
    return (
      <div className="flex flex-col h-full">
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
    <div className="flex flex-col gap-6 p-4">
      <p className="h-7 text-xl text-zinc-950 dark:text-white">Functions</p>
      <div className="flex flex-col gap-2">
        {/* Table Header */}
        <div className="grid grid-cols-12 px-3 text-sm text-muted-foreground dark:text-neutral-400">
          <div className="col-span-2 py-1 px-3">Name</div>
          <div className="col-span-6 py-1 px-3">URL</div>
          <div className="col-span-2 py-1 px-3">Created</div>
          <div className="col-span-2 py-1 px-3">Last Update</div>
        </div>
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
              />
            ))}
          </>
        ) : (
          <div className="cols-span-full">
            <FunctionEmptyState />
          </div>
        )}
      </div>
    </div>
  );
}
