import { ArrowLeft, Download, Edit3, Trash2, Upload } from 'lucide-react';
import { FunctionRow } from '#features/functions/components/FunctionRow';
import FunctionEmptyState from '#features/functions/components/FunctionEmptyState';
import { useFunctions } from '#features/functions/hooks/useFunctions';
import { useToast } from '#lib/hooks/useToast';
import { useState, useCallback, useRef, useEffect } from 'react';
import RefreshIcon from '#assets/icons/refresh.svg?react';
import {
  Button,
  ConfirmDialog,
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@insforge/ui';
import { CodeEditor, Skeleton, TableHeader } from '#components';
import { useConfirm } from '#lib/hooks/useConfirm';

const MAX_FUNCTION_FILE_SIZE_BYTES = 1024 * 1024;
const ALLOWED_FUNCTION_FILE_EXTENSIONS = ['.ts', '.js', '.tsx', '.jsx'];

export default function FunctionsPage() {
  const toastShownRef = useRef(false);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [isScrolled, setIsScrolled] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const [isEditingCode, setIsEditingCode] = useState(false);
  const [editedCode, setEditedCode] = useState('');
  const { showToast } = useToast();
  const { confirm, confirmDialogProps } = useConfirm();
  const {
    functions,
    isRuntimeAvailable,
    selectedFunction,
    isLoading,
    selectFunction,
    clearSelection,
    refetch,
    deploymentUrl,
    deleteFunction,
    updateFunction,
    isDeleting,
    isUpdating,
  } = useFunctions();
  const isMutatingFunction = isUpdating || isDeleting;

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

  useEffect(() => {
    setIsEditingCode(false);
    setEditedCode('');
    if (fileInputRef.current) {
      fileInputRef.current.value = '';
    }
  }, [selectedFunction?.id]);

  const handleDownloadCode = useCallback((code: string, slug: string) => {
    const blob = new Blob([code], { type: 'text/javascript;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `${slug}.ts`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  }, []);

  const handleDeleteFunction = useCallback(
    async (slug: string, name: string) => {
      if (isMutatingFunction) {
        return;
      }

      try {
        const confirmed = await confirm({
          title: 'Delete Function',
          description: `Are you sure you want to delete the function "${name}"? This action cannot be undone.`,
          confirmText: 'Delete',
          cancelText: 'Cancel',
          destructive: true,
        });

        if (!confirmed) {
          return;
        }

        await deleteFunction(slug);
      } catch (error) {
        console.error('Failed to delete function', error);
      }
    },
    [confirm, deleteFunction, isMutatingFunction]
  );

  const handleStartEditCode = useCallback(
    (initialCode: string | null | undefined) => {
      if (isMutatingFunction) {
        return;
      }

      setEditedCode(initialCode ?? '');
      setIsEditingCode(true);
    },
    [isMutatingFunction]
  );

  const handleCancelEditCode = useCallback(() => {
    setIsEditingCode(false);
    setEditedCode('');
  }, []);

  const handleSaveCode = useCallback(
    async (slug: string) => {
      if (isMutatingFunction) {
        return;
      }

      try {
        const result = await updateFunction(slug, { code: editedCode });
        if (result.success && result.deployment?.status !== 'failed') {
          setIsEditingCode(false);
        }
      } catch (error) {
        console.error('Failed to update function code', error);
      }
    },
    [editedCode, isMutatingFunction, updateFunction]
  );

  const handleUploadFile = useCallback(() => {
    if (isMutatingFunction) {
      return;
    }

    fileInputRef.current?.click();
  }, [isMutatingFunction]);

  const handleFileChange = useCallback(
    (event: React.ChangeEvent<HTMLInputElement>) => {
      void (async () => {
        try {
          if (isMutatingFunction) {
            return;
          }

          const file = event.target.files?.[0];
          if (!file) {
            return;
          }

          const normalizedFileName = file.name.toLowerCase();
          const matchedExtension = ALLOWED_FUNCTION_FILE_EXTENSIONS.find((extension) =>
            normalizedFileName.endsWith(extension)
          );

          if (!matchedExtension) {
            showToast('Invalid file type. Please upload a .ts, .js, .tsx, or .jsx file.', 'error');
            return;
          }

          if (file.size > MAX_FUNCTION_FILE_SIZE_BYTES) {
            showToast(
              'Function file is too large. Please upload a file smaller than 1 MB.',
              'error'
            );
            return;
          }

          const text = await file.text();
          setEditedCode(text);
          setIsEditingCode(true);
        } catch (error) {
          console.error('Failed to read function file', error);
          showToast('Failed to read function file', 'error');
        } finally {
          // reset input so same file can be selected again
          event.target.value = '';
        }
      })();
    },
    [isMutatingFunction, showToast]
  );

  // Detail view for selected function
  if (selectedFunction) {
    return (
      <div className="h-full flex flex-col overflow-hidden bg-[rgb(var(--semantic-1))]">
        <div className="flex items-center shrink-0 border-b border-[var(--alpha-8)] bg-[rgb(var(--semantic-0))]">
          <div className="flex flex-1 items-center gap-3 pl-4 pr-3 py-3">
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
          <div className="flex items-center gap-2 pr-4">
            <input
              ref={fileInputRef}
              type="file"
              accept=".ts,.js,.tsx,.jsx"
              className="hidden"
              onChange={handleFileChange}
            />
            <Button
              variant="ghost"
              size="icon"
              onClick={() =>
                selectedFunction.code &&
                handleDownloadCode(selectedFunction.code, selectedFunction.slug)
              }
              disabled={!selectedFunction.code}
              aria-label="Download function code"
              className="h-8 w-8 rounded p-1.5 text-muted-foreground hover:bg-[var(--alpha-4)] active:bg-[var(--alpha-8)]"
              title="Download function code"
            >
              <Download className="h-4 w-4" />
            </Button>
            <Button
              variant="ghost"
              size="icon"
              onClick={handleUploadFile}
              aria-label="Upload function file"
              disabled={isMutatingFunction}
              className="h-8 w-8 rounded p-1.5 text-muted-foreground hover:bg-[var(--alpha-4)] active:bg-[var(--alpha-8)]"
              title="Upload function file"
            >
              <Upload className="h-4 w-4" />
            </Button>
            <Button
              variant="ghost"
              size="icon"
              onClick={() => handleStartEditCode(selectedFunction.code)}
              aria-label="Edit function code"
              className="h-8 w-8 rounded p-1.5 text-muted-foreground hover:bg-[var(--alpha-4)] active:bg-[var(--alpha-8)]"
              title="Edit function code"
              disabled={isMutatingFunction}
            >
              <Edit3 className="h-4 w-4" />
            </Button>
            <Button
              variant="ghost"
              size="icon"
              onClick={() =>
                void handleDeleteFunction(selectedFunction.slug, selectedFunction.name)
              }
              aria-label="Delete function"
              className="h-8 w-8 rounded p-1.5 text-destructive hover:bg-[var(--alpha-4)] active:bg-[var(--alpha-8)]"
              title="Delete function"
              disabled={isMutatingFunction}
            >
              <Trash2 className="h-4 w-4" />
            </Button>
          </div>
        </div>
        <div className="flex-1 min-h-0">
          {isEditingCode ? (
            <div className="h-full flex flex-col">
              <div className="flex items-center justify-end gap-2 border-b border-[var(--alpha-8)] bg-[rgb(var(--semantic-0))] px-4 py-2">
                <Button
                  variant="secondary"
                  size="sm"
                  onClick={handleCancelEditCode}
                  disabled={isMutatingFunction}
                  className="h-8 px-2"
                >
                  Cancel
                </Button>
                <Button
                  size="sm"
                  onClick={() => void handleSaveCode(selectedFunction.slug)}
                  disabled={isMutatingFunction}
                  className="h-8 px-2"
                >
                  {isUpdating ? 'Saving…' : 'Save'}
                </Button>
              </div>
              <div className="flex-1 min-h-0">
                <CodeEditor
                  value={editedCode}
                  onChange={(value) => setEditedCode(value)}
                  editable
                  language="javascript"
                />
              </div>
            </div>
          ) : (
            <CodeEditor code={selectedFunction.code || '// No code available'} />
          )}
        </div>
        <ConfirmDialog {...confirmDialogProps} />
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
