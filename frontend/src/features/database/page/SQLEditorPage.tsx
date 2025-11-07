import { useState, useEffect, useMemo } from 'react';
import { useRawSQL } from '@/features/database/hooks/useRawSQL';
import { Button } from '@/components/radix/Button';
import { CodeEditor } from '@/components/CodeEditor';
import { DataGrid, type DataGridColumn, type DataGridRow } from '@/components/datagrid';

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

const STORAGE_KEY = 'sql-editor-query';

export default function SQLEditorPage() {
  // Load query from localStorage on mount
  const [query, setQuery] = useState(() => {
    const saved = localStorage.getItem(STORAGE_KEY);
    return saved || '';
  });

  const { executeSQL, isPending, data, isSuccess, error, isError } = useRawSQL({
    showSuccessToast: true,
    showErrorToast: false, // Don't show toast, we'll display in results
  });

  // Save query to localStorage whenever it changes
  useEffect(() => {
    localStorage.setItem(STORAGE_KEY, query);
  }, [query]);

  const handleExecuteQuery = () => {
    if (!query.trim() || isPending) {
      return;
    }

    executeSQL({ query, params: [] });
  };

  return (
    <div className="flex flex-col h-full bg-bg-gray dark:bg-neutral-800 overflow-auto">
      {/* Header */}
      <div className="flex items-center gap-3 h-[72px] px-6 bg-bg-gray dark:bg-neutral-800 flex-shrink-0">
        <h1 className="text-xl font-semibold text-black dark:text-white">SQL Editor</h1>
      </div>

      {/* Main Content */}
      <div className="flex flex-1 flex-col gap-6 px-6 bg-bg-gray dark:bg-neutral-800 items-center pb-6">
        {/* Code Editor Section */}
        <div className="h-[500px] w-full bg-white dark:bg-neutral-900/50 border border-gray-200 dark:border-neutral-700 rounded-lg overflow-hidden">
          <CodeEditor
            editable
            language="sql"
            value={query}
            onChange={setQuery}
            placeholder="SELECT * FROM users WHERE email = 'user@example.com';"
          />
        </div>

        {/* Run Button */}
        <div className="w-full flex justify-end">
          <Button
            onClick={handleExecuteQuery}
            disabled={isPending || !query.trim()}
            className="h-8 px-6 gap-1 bg-zinc-950 hover:bg-zinc-800 text-white dark:bg-emerald-300 dark:hover:bg-emerald-400 dark:text-black text-sm disabled:opacity-50"
          >
            Run
          </Button>
        </div>

        {/* Divider */}
        <div className="w-full h-px bg-gray-200 dark:bg-neutral-700" />

        {/* Results Section */}
        <div className="flex-1 flex flex-col gap-4 w-full">
          {/* Results Heading */}
          <h2 className="text-base font-semibold text-black dark:text-white">Results</h2>

          {/* Results Content */}
          <div className="flex-1">
            {isError && error ? (
              <ErrorViewer error={error} />
            ) : isSuccess && data ? (
              <ResultsViewer data={data.rows || data.data || data} />
            ) : (
              <div className="h-full bg-neutral-100 dark:bg-neutral-900/50 rounded-lg flex items-center justify-center text-neutral-500 dark:text-neutral-400 text-sm">
                {isPending ? 'Executing query...' : 'Run a query to see results'}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
