import { useMemo, useState, useRef, useEffect } from 'react';
import { useRawSQL } from '@/features/database/hooks/useRawSQL';
import { useSQLEditorContext } from '@/features/database/contexts/SQLEditorContext';
import {
  Badge,
  Button,
  CodeEditor,
  DataGrid,
  type DataGridColumn,
  type DataGridRow,
} from '@/components';
import { X, Plus } from 'lucide-react';
import { cn } from '@/lib/utils/utils';

interface ResultsViewerProps {
  data: unknown;
}

// Helper to detect if data is an array of row objects
function isRowData(data: unknown): data is Record<string, unknown>[] {
  return (
    Array.isArray(data) &&
    data.length > 0 &&
    typeof data[0] === 'object' &&
    data[0] !== null &&
    !Array.isArray(data[0])
  );
}

// Convert SQL result rows to DataGrid format
function convertRowsToDataGridFormat(rows: Record<string, unknown>[]) {
  // Add synthetic id field if rows don't have one - ensure id is always a string
  const dataWithIds: DataGridRow[] = rows.map((row, index) => ({
    ...row,
    id: String(row.id || `row-${index}`),
  }));

  // Get all column keys from first row
  const columnKeys = Object.keys(rows[0]);

  // Create simple columns that render values as plain strings
  const columns: DataGridColumn<DataGridRow>[] = columnKeys.map((key) => ({
    key,
    name: key,
    width: 'minmax(200px, 1fr)',
    resizable: true,
    sortable: true,
    editable: false,
  }));

  return { columns, data: dataWithIds };
}

function ResultsViewer({ data }: ResultsViewerProps) {
  // Check if data is row data (array of objects)
  const isTable = isRowData(data);

  const gridData = useMemo(() => {
    if (isTable && data.length > 0) {
      return convertRowsToDataGridFormat(data);
    }
    return null;
  }, [isTable, data]);

  if (isTable && gridData) {
    // Render as table
    return (
      <div className="w-full">
        <DataGrid
          data={gridData.data}
          columns={gridData.columns}
          showSelection={false}
          showPagination={false}
          noPadding={true}
          className="h-full"
        />
      </div>
    );
  }

  // Render as JSON for non-table data
  const jsonString = JSON.stringify(data, null, 2);
  const lines = jsonString.split('\n');

  return (
    <div className="bg-neutral-100 dark:bg-neutral-900/50 rounded-lg p-3 overflow-auto">
      <pre className="font-mono text-sm text-black dark:text-white leading-5 m-0">
        {lines.map((line, index) => (
          <div key={index} className="min-h-[1.25rem]">
            {line || <span>&nbsp;</span>}
          </div>
        ))}
      </pre>
    </div>
  );
}

interface ErrorViewerProps {
  error: Error;
}

function ErrorViewer({ error }: ErrorViewerProps) {
  return (
    <div className="bg-neutral-100 dark:bg-neutral-800 rounded-lg p-3 overflow-auto">
      <pre className="font-mono text-sm text-red-600 dark:text-red-400 leading-5 m-0 whitespace-pre-wrap">
        {error.message}
      </pre>
    </div>
  );
}

export default function SQLEditorPage() {
  const {
    tabs,
    activeTab,
    activeTabId,
    addTab,
    removeTab,
    setActiveTab,
    updateTabQuery,
    updateTabName,
  } = useSQLEditorContext();

  const [editingTabId, setEditingTabId] = useState<string | null>(null);
  const [editingTabName, setEditingTabName] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);

  const { executeSQL, isPending, data, isSuccess, error, isError } = useRawSQL({
    showSuccessToast: true,
    showErrorToast: false, // Don't show toast, we'll display in results
  });

  useEffect(() => {
    if (editingTabId && inputRef.current) {
      inputRef.current.focus();
      inputRef.current.select();
    }
  }, [editingTabId]);

  const handleExecuteQuery = () => {
    if (!activeTab?.query.trim() || isPending) {
      return;
    }

    executeSQL({ query: activeTab.query, params: [] });
  };

  const handleQueryChange = (newQuery: string) => {
    if (activeTabId) {
      updateTabQuery(activeTabId, newQuery);
    }
  };

  const handleTabNameDoubleClick = (tabId: string, currentName: string) => {
    setEditingTabId(tabId);
    setEditingTabName(currentName);
  };

  const handleTabNameChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setEditingTabName(e.target.value);
  };

  const handleTabNameBlur = () => {
    if (editingTabId && editingTabName.trim()) {
      updateTabName(editingTabId, editingTabName.trim());
    }
    setEditingTabId(null);
    setEditingTabName('');
  };

  const handleTabNameKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') {
      handleTabNameBlur();
    } else if (e.key === 'Escape') {
      setEditingTabId(null);
      setEditingTabName('');
    }
  };

  return (
    <div className="flex flex-col h-full bg-bg-gray dark:bg-neutral-800 overflow-auto">
      {/* Header */}
      <div className="flex items-center gap-3 h-[72px] px-4 bg-bg-gray dark:bg-neutral-800 flex-shrink-0">
        <h1 className="text-xl font-semibold text-black dark:text-white">SQL Editor</h1>
      </div>

      {/* Main Content */}
      <div className="flex flex-1 flex-col px-4 gap-3 bg-bg-gray dark:bg-neutral-800 items-center pb-6">
        {/* Tabs and Editor Combined Section */}
        <div className="w-full flex flex-col">
          {/* Tabs Section */}
          <div className="w-full flex items-end overflow-hidden">
            <div className="flex items-end overflow-x-auto overflow-y-hidden scrollbar-hide">
              {tabs.map((tab) => {
                const isActive = tab.id === activeTabId;
                return (
                  <div
                    key={tab.id}
                    className={cn(
                      'h-8 group relative flex items-center gap-1 px-2 cursor-pointer',
                      'min-w-[110px] max-w-[200px] rounded-t-lg',
                      'border-t border-l border-r border-gray-300 dark:border-neutral-700',
                      isActive
                        ? 'bg-white dark:bg-[#1E1E1E] text-black dark:text-white z-10'
                        : 'bg-gray-200 dark:bg-neutral-800 text-neutral-600 dark:text-neutral-400 hover:bg-gray-300 dark:hover:bg-neutral-600'
                    )}
                    onClick={() => setActiveTab(tab.id)}
                    role="button"
                    tabIndex={0}
                    onKeyDown={(e) => {
                      // Don't handle keyboard events if we're editing
                      if (editingTabId === tab.id) {
                        return;
                      }
                      if (e.key === 'Enter' || e.key === ' ') {
                        e.preventDefault();
                        setActiveTab(tab.id);
                      }
                    }}
                  >
                    {editingTabId === tab.id ? (
                      <input
                        ref={inputRef}
                        type="text"
                        value={editingTabName}
                        onChange={handleTabNameChange}
                        onBlur={handleTabNameBlur}
                        onKeyDown={(e) => {
                          // Stop propagation to prevent parent handlers from interfering
                          e.stopPropagation();
                          handleTabNameKeyDown(e);
                        }}
                        className={cn(
                          'pl-2 pr-1 text-sm font-medium bg-transparent',
                          'border-none outline-none focus:outline-none w-full min-w-0',
                          'text-black dark:text-white'
                        )}
                        onClick={(e) => e.stopPropagation()}
                      />
                    ) : (
                      <>
                        <span
                          className={cn(
                            'pl-2 text-sm font-medium whitespace-nowrap overflow-hidden text-ellipsis',
                            'flex-1 min-w-0'
                          )}
                          onDoubleClick={(e) => {
                            e.stopPropagation();
                            handleTabNameDoubleClick(tab.id, tab.name);
                          }}
                        >
                          {tab.name}
                        </span>
                        {tabs.length > 1 && (
                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              removeTab(tab.id);
                            }}
                            className={cn(
                              'flex-shrink-0 opacity-0 group-hover:opacity-100 transition-opacity',
                              'text-neutral-400 hover:text-black dark:hover:text-white',
                              'rounded p-0.5 hover:bg-gray-200 dark:hover:bg-neutral-700',
                              'focus:outline-none focus-visible:outline-none'
                            )}
                            aria-label="Close tab"
                          >
                            <X className="w-3.5 h-3.5" />
                          </button>
                        )}
                      </>
                    )}
                  </div>
                );
              })}
              <button
                onClick={() => addTab()}
                className={cn(
                  'h-8 group relative flex items-center justify-center px-3 py-1.5',
                  'cursor-pointer transition-colors min-w-[40px]',
                  'focus:outline-none focus-visible:outline-none',
                  'text-neutral-500 dark:text-neutral-400',
                  'hover:bg-gray-200/70 dark:hover:bg-neutral-700',
                  'hover:text-black dark:hover:text-white rounded-t-lg'
                )}
                aria-label="Add new tab"
              >
                <Plus className="w-4 h-4" />
              </button>
            </div>
          </div>

          {/* Code Editor Section */}
          <div
            className={cn(
              'h-[480px] w-full',
              'bg-white dark:bg-neutral-900/50',
              'border border-gray-200 dark:border-neutral-700',
              'rounded-lg rounded-tl-none overflow-hidden -mt-px'
            )}
          >
            <CodeEditor
              editable
              language="sql"
              value={activeTab?.query || ''}
              onChange={handleQueryChange}
              placeholder="SELECT * from products LIMIT 10;"
            />
          </div>
        </div>

        {/* Run Button */}
        <div className="w-full flex justify-end">
          <Button
            onClick={handleExecuteQuery}
            disabled={isPending || !activeTab?.query.trim()}
            className={cn(
              'h-8 px-6 gap-1 text-sm',
              'bg-zinc-950 hover:bg-zinc-800 text-white',
              'dark:bg-emerald-300 dark:hover:bg-emerald-400 dark:text-black',
              'disabled:opacity-50'
            )}
          >
            Run
          </Button>
        </div>

        {/* Divider */}
        <div className="w-full h-px bg-gray-200 dark:bg-neutral-700" />

        {/* Results Section */}
        <div className="flex-1 flex flex-col gap-4 w-full">
          {/* Results Heading */}
          <div className="flex items-center gap-2">
            <h2 className="text-base font-semibold text-black dark:text-white">Results</h2>
            {isSuccess && (
              <Badge
                className={cn(
                  'px-2 py-0.5 border-transparent',
                  'bg-emerald-500/10 text-emerald-600',
                  'dark:bg-emerald-500/20 dark:text-emerald-400'
                )}
              >
                Success
              </Badge>
            )}
            {isError && (
              <Badge
                className={cn(
                  'px-2 py-0.5 border-transparent',
                  'bg-red-500/10 text-red-600',
                  'dark:bg-red-500/20 dark:text-red-400'
                )}
              >
                Error
              </Badge>
            )}
          </div>

          {/* Results Content */}
          <div className="flex-1">
            {isError && error ? (
              <ErrorViewer error={error} />
            ) : isSuccess && data ? (
              <ResultsViewer data={data.rows || data.data || data} />
            ) : (
              <div
                className={cn(
                  'h-full rounded-lg flex items-center justify-center text-sm',
                  'bg-neutral-100 dark:bg-neutral-900/50',
                  'text-neutral-500 dark:text-neutral-400'
                )}
              >
                {isPending ? 'Executing query...' : 'Run a query to see results'}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
