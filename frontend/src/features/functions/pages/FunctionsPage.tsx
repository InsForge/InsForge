import { ArrowLeft } from 'lucide-react';
import { FunctionRow } from '../components/FunctionRow';
import FunctionEmptyState from '../components/FunctionEmptyState';
import { useFunctions } from '../hooks/useFunctions';
import { useToast } from '@/lib/hooks/useToast';
import { useState, useCallback, useRef, useEffect } from 'react';
import RefreshIcon from '@/assets/icons/refresh.svg?react';
import { Button, Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@insforge/ui';
import { CodeEditor, Skeleton, TableHeader } from '@/components';

export default function FunctionsPage() {
  const toastShownRef = useRef(false);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [isScrolled, setIsScrolled] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);
  const { showToast } = useToast();
  const {
    functions,
    isRuntimeAvailable,
    selectedFunction,
    isLoading,
    selectFunction,
    clearSelection,
    refetch,
    deploymentUrl,
  } = useFunctions();

  const handleScroll = useCallback(() => {
    if (scrollRef.current) {
      setIsScrolled(scrollRef.current.scrollTop > 0);
    }
  }, []);

  const handleSearchChange = useCallback((value: string) => {
    setSearchQuery(value);
  }, []);

  const filteredFunctions = searchQuery
    ? functions.filter(
        (fn) =>
          fn.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
          fn.slug.toLowerCase().includes(searchQuery.toLowerCase())
      )
    : functions;

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

  // Detail view for selected function
  if (selectedFunction) {
    return (
      <div className="h-full flex flex-col overflow-hidden bg-[rgb(var(--semantic-1))]">
        <div className="flex items-center shrink-0 border-b border-[var(--alpha-8)] bg-[rgb(var(--semantic-0))]">
          <div className="flex items-center gap-3 pl-4 pr-3 py-3">
            <button
              onClick={clearSelection}
              className="flex items-center justify-center size-8 rounded border border-[var(--alpha-8)] bg-card hover:bg-[var(--alpha-8)] transition-colors"
            >
              <ArrowLeft className="size-5 text-foreground" />
            </button>
            <h1 className="text-base font-medium leading-7 text-foreground">
              {selectedFunction.name}
            </h1>
          </div>
        </div>
        <div className="flex-1 min-h-0">
          <CodeEditor code={selectedFunction.code || '// No code available'} />
        </div>
      </div>
    );
  }

  // List view
  return (
    <div className="h-full flex flex-col overflow-hidden bg-[rgb(var(--semantic-1))]">
      <TableHeader
        className="min-w-[800px]"
        leftContent={
          <div className="flex flex-1 items-center overflow-clip">
            <h1 className="shrink-0 text-base font-medium leading-7 text-foreground">
              Edge Functions
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
                    onClick={() => void handleRefresh()}
                    disabled={isRefreshing}
                    className="h-8 w-8 rounded p-1.5 text-muted-foreground hover:bg-[var(--alpha-4)] active:bg-[var(--alpha-8)]"
                  >
                    <RefreshIcon className={isRefreshing ? 'h-5 w-5 animate-spin' : 'h-5 w-5'} />
                  </Button>
                </TooltipTrigger>
                <TooltipContent side="bottom" align="center">
                  <p>{isRefreshing ? 'Refreshing...' : 'Refresh'}</p>
                </TooltipContent>
              </Tooltip>
            </TooltipProvider>
          </div>
        }
        searchValue={searchQuery}
        onSearchChange={handleSearchChange}
        searchDebounceTime={300}
        searchPlaceholder="Search functions"
      />

      {/* Scrollable Content */}
      <div
        ref={scrollRef}
        onScroll={handleScroll}
        className="flex-1 min-h-0 overflow-y-auto relative"
      >
        {/* Top spacing */}
        <div className="h-3" />

        {/* Sticky Table Header */}
        <div
          className={`sticky top-0 z-10 bg-[rgb(var(--semantic-1))] px-3 ${isScrolled ? 'border-b border-[var(--alpha-8)]' : ''}`}
        >
          <div className="flex items-center h-8 pl-2 text-sm text-muted-foreground">
            <div className="flex-[1.5] py-1.5 px-2.5">Name</div>
            <div className="flex-[3] py-1.5 px-2.5">URL</div>
            <div className="flex-[1.5] py-1.5 px-2.5">Created</div>
            <div className="flex-1 py-1.5 px-2.5">Last Update</div>
          </div>
        </div>

        {/* Table Body */}
        <div className="flex flex-col px-3 pb-4">
          <div className="flex flex-col gap-1 pt-1">
            {isLoading ? (
              <>
                {[...Array(4)].map((_, i) => (
                  <Skeleton key={i} className="h-12 rounded" />
                ))}
              </>
            ) : filteredFunctions.length >= 1 ? (
              <>
                {filteredFunctions.map((func) => (
                  <FunctionRow
                    key={func.id}
                    function={func}
                    onClick={() => void selectFunction(func)}
                    deploymentUrl={deploymentUrl}
                  />
                ))}
              </>
            ) : (
              <FunctionEmptyState />
            )}
          </div>
        </div>

        {/* Loading mask overlay */}
        {isRefreshing && (
          <div className="absolute inset-0 bg-[rgb(var(--semantic-1))] flex items-center justify-center z-50">
            <div className="flex items-center gap-1">
              <div className="w-5 h-5 border-2 border-muted-foreground border-t-transparent rounded-full animate-spin" />
              <span className="text-sm text-muted-foreground">Loading</span>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
