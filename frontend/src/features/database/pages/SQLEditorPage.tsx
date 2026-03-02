import { useMemo, useState, useRef, useEffect } from 'react';
import { useRawSQL } from '@/features/database/hooks/useRawSQL';
import { useSQLEditorContext } from '@/features/database/contexts/SQLEditorContext';
import { Button, Tabs, Tab } from '@insforge/ui';
import { CodeEditor, DataGrid, type DataGridColumn, type DataGridRow } from '@/components';
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
    name: key.charAt(0).toUpperCase() + key.slice(1),
    width: 'minmax(200px, 1fr)',
    resizable: true,
    sortable: true,
    editable: false,
  }));

  return { columns, data: dataWithIds };
}

function RawViewer({ data }: ResultsViewerProps) {
  const jsonString = JSON.stringify(data, null, 2);
  const lines = jsonString.split('\n');

  return (
    <div className="bg-[var(--alpha-4)] rounded-lg p-3 overflow-auto">
      <pre className="font-mono text-sm text-foreground leading-5 m-0">
        {lines.map((line, index) => (
          <div key={index} className="min-h-[1.25rem]">
            {line || <span>&nbsp;</span>}
          </div>
        ))}
      </pre>
    </div>
  );
}

function ResultsViewer({ data }: ResultsViewerProps) {
  const isTable = isRowData(data);

  const gridData = useMemo(() => {
    if (isTable && data.length > 0) {
      return convertRowsToDataGridFormat(data);
    }
    return null;
  }, [isTable, data]);

  if (isTable && gridData) {
    return (
      <DataGrid
        data={gridData.data}
        columns={gridData.columns}
        showSelection={false}
        showPagination={false}
        noPadding={true}
        className="h-full"
      />
    );
  }

  // Fallback to raw JSON if data isn't table-shaped
  return <RawViewer data={data} />;
}

interface ErrorViewerProps {
  error: Error;
}

function ErrorViewer({ error }: ErrorViewerProps) {
  return (
    <div className="bg-[var(--alpha-4)] rounded-lg p-3 overflow-auto">
      <pre className="font-mono text-sm text-destructive leading-5 m-0 whitespace-pre-wrap">
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
  const [resultView, setResultView] = useState<'result' | 'chart'>('result');
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
    <div className="flex flex-col h-full bg-[rgb(var(--semantic-1))] overflow-hidden">
      {/* Tab Header: Figma h-56, items-center, bg #1b1b1b, border-b */}
      <div className="flex items-center h-14 min-w-[800px] bg-[rgb(var(--semantic-1))] border-b border-[var(--alpha-8)] shrink-0">
        {/* Title: h-full, px-16, py-12 */}
        <div className="flex items-center h-full overflow-clip px-4 py-3 shrink-0">
          <span className="text-base font-medium leading-7 text-black dark:text-white whitespace-nowrap">
            SQL Editor
          </span>
        </div>

        {/* Tab Nav: h-full, items-center */}
        <div className="flex items-center h-full shrink-0">
          {/* Tab container: h-full, overflow-clip */}
          <div className="flex items-center h-full overflow-clip">
            {tabs.map((tab) => {
              const isActive = tab.id === activeTabId;
              return (
                <div
                  key={tab.id}
                  className={cn(
                    'flex flex-col h-full shrink-0 w-[106px] cursor-pointer',
                    isActive ? 'bg-[rgb(var(--semantic-0))]' : ''
                  )}
                  onClick={() => setActiveTab(tab.id)}
                  role="button"
                  tabIndex={0}
                  onKeyDown={(e) => {
                    if (editingTabId === tab.id) {
                      return;
                    }
                    if (e.key === 'Enter' || e.key === ' ') {
                      e.preventDefault();
                      setActiveTab(tab.id);
                    }
                  }}
                >
                  {/* Inner status: border-l, flex-1, items-center, px-10, gap-6 */}
                  <div className="flex flex-1 items-center w-full px-2.5 gap-1.5 border-l border-[var(--alpha-8)]">
                    {editingTabId === tab.id ? (
                      <input
                        ref={inputRef}
                        type="text"
                        value={editingTabName}
                        onChange={handleTabNameChange}
                        onBlur={handleTabNameBlur}
                        onKeyDown={(e) => {
                          e.stopPropagation();
                          handleTabNameKeyDown(e);
                        }}
                        className="flex-1 min-w-0 px-1.5 text-[13px] font-medium leading-[18px] bg-transparent border-none outline-none text-black dark:text-white"
                        onClick={(e) => e.stopPropagation()}
                      />
                    ) : (
                      <>
                        {/* Context container: px-6, shrink-0 */}
                        <div
                          className="flex items-center justify-center px-1.5 shrink-0 min-w-0"
                          onDoubleClick={(e) => {
                            e.stopPropagation();
                            handleTabNameDoubleClick(tab.id, tab.name);
                          }}
                        >
                          <span
                            className={cn(
                              'text-[13px] font-medium leading-[18px] whitespace-nowrap truncate',
                              isActive
                                ? 'text-black dark:text-white'
                                : 'text-neutral-500 dark:text-neutral-400'
                            )}
                          >
                            {tab.name}
                          </span>
                        </div>
                        {/* Close button: shrink-0 */}
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            if (tabs.length > 1) {
                              removeTab(tab.id);
                            }
                          }}
                          className={cn(
                            'flex items-center justify-center shrink-0 rounded',
                            tabs.length <= 1 && 'invisible'
                          )}
                          aria-label="Close tab"
                        >
                          <X className="w-5 h-5 text-neutral-400 hover:text-black dark:hover:text-white" />
                        </button>
                      </>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
          {/* Add tab: w-40, h-full */}
          <div
            className="flex flex-col h-full shrink-0 w-10 cursor-pointer"
            onClick={() => addTab()}
            role="button"
            tabIndex={0}
            onKeyDown={(e) => {
              if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault();
                addTab();
              }
            }}
          >
            <div className="flex flex-1 items-center justify-center w-full border-l border-[var(--alpha-8)]">
              <Plus className="w-5 h-5 text-neutral-400 hover:text-black dark:hover:text-white transition-colors" />
            </div>
          </div>
        </div>
      </div>

      {/* Main Content */}
      <div className="flex flex-1 flex-col overflow-hidden">
        {/* Code Editor Section */}
        <div className="flex-1 w-full bg-[rgb(var(--semantic-0))] overflow-hidden">
          <CodeEditor
            editable
            language="sql"
            value={activeTab?.query || ''}
            onChange={handleQueryChange}
            placeholder="SELECT * from products LIMIT 10;"
          />
        </div>

        {/* Bottom Half: Toggle Nav + Results */}
        <div className="flex-1 flex flex-col overflow-hidden">
          {/* Tabs + Run Button */}
          <div className="flex px-4 py-3 justify-between items-start shrink-0 border-t border-b border-[var(--alpha-8)] bg-[rgb(var(--semantic-0))]">
            {/* Tabs */}
            <Tabs value={resultView} onValueChange={setResultView}>
              <Tab value="result">
                Result
                {isSuccess && data && isRowData(Array.isArray(data) ? data : data.rows) && (
                  <span className="flex items-center justify-center px-2 py-0.5 rounded bg-[var(--alpha-8)] text-xs font-medium text-muted-foreground">
                    {(Array.isArray(data) ? data : data.rows).length}
                  </span>
                )}
              </Tab>
              <Tab value="chart">Chart</Tab>
            </Tabs>
            {/* Run Button */}
            <Button onClick={handleExecuteQuery} disabled={isPending || !activeTab?.query.trim()}>
              Run
            </Button>
          </div>

          {/* Results Content */}
          <div
            className={cn(
              'flex-1 min-h-0 w-full overflow-auto bg-[rgb(var(--semantic-0))]',
              resultView === 'result' && 'px-4 py-3'
            )}
          >
            {isError && error ? (
              <div className={resultView !== 'result' ? 'px-4 py-3' : ''}>
                <ErrorViewer error={error} />
              </div>
            ) : isSuccess && data ? (
              resultView === 'result' ? (
                <RawViewer data={data.rows || data} />
              ) : (
                <ResultsViewer data={data.rows || data} />
              )
            ) : (
              <p
                className={cn(
                  'font-mono text-sm leading-5 text-foreground',
                  resultView !== 'result' && 'px-4 py-3'
                )}
              >
                {isPending ? 'Executing query...' : 'Click Run to execute your query'}
              </p>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
