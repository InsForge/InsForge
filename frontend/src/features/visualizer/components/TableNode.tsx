import { Database, Circle, Key } from 'lucide-react';
import { Handle, Position } from '@xyflow/react';
import { TableSchema } from '@insforge/shared-schemas';

interface TableNodeProps {
  data: {
    table: TableSchema;
    referencedColumns?: string[]; // List of column names that are referenced by other tables
  };
}

export function TableNode({ data }: TableNodeProps) {
  const { table, referencedColumns = [] } = data;

  const getColumnIcon = (isReferenced: boolean = false) => {
    // If column is referenced by another table (has incoming connections)
    // Show outer gray diamond with inner white diamond
    if (isReferenced) {
      return (
        <div className="w-4 h-4 flex items-center justify-center relative">
          {/* Outer gray diamond */}
          <div className="w-4 h-4 bg-gray-200 dark:bg-neutral-800 border border-zinc-950 dark:border-white absolute transform rotate-45" />
          {/* Inner white diamond */}
          <div className="w-2 h-2 bg-zinc-950 dark:bg-white absolute transform rotate-45" />
        </div>
      );
    }
    return (
      <div className="w-4 h-4 flex items-center justify-center relative">
        {/* Outer gray diamond */}
        <div className="w-4 h-4 bg-gray-200 dark:bg-neutral-800 border border-gray-400 dark:border-neutral-700 absolute transform rotate-45" />
      </div>
    );
  };

  return (
    <div className="bg-white dark:bg-neutral-900 rounded-lg border border-gray-300 dark:border-[#363636] min-w-[320px] shadow-sm">
      {/* Table Header */}
      <div className="flex items-center justify-between p-2 border-b border-gray-200 dark:border-neutral-800">
        <div className="flex items-center gap-2">
          <div className="flex items-center justify-center w-11 h-11 bg-teal-300 rounded p-1.5">
            <Database className="w-5 h-5 text-neutral-900" />
          </div>
          <div className="flex-1">
            <h3 className="text-sm font-medium text-zinc-950 dark:text-white">{table.tableName}</h3>
            <p className="text-xs text-zinc-600 dark:text-neutral-300">
              {table.recordCount !== undefined
                ? `${table.recordCount.toLocaleString()} data`
                : '0 data'}
            </p>
          </div>
        </div>
        {/* <div className="p-1.5">
          <ExternalLink className="w-4 h-4 text-neutral-400" />
        </div> */}
      </div>

      {/* Columns */}
      <div>
        {table.columns.map((column) => (
          <div
            key={column.columnName}
            className="flex items-center justify-between p-3 border-b border-gray-200 dark:border-neutral-800 relative"
          >
            {/* Source handle for foreign key columns - invisible and non-interactive */}
            {column.foreignKey && (
              <Handle
                type="source"
                position={Position.Right}
                id={`${column.columnName}-source`}
                className="!w-3 !h-3 !opacity-0 !border-0 !pointer-events-none"
                style={{
                  right: 16,
                  top: '50%',
                  transform: 'translateY(-50%)',
                  pointerEvents: 'none',
                }}
                isConnectable={false}
              />
            )}

            {/* Target handle for columns that can be referenced - invisible and non-interactive */}
            {referencedColumns.includes(column.columnName) && (
              <Handle
                type="target"
                position={Position.Left}
                id={`${column.columnName}-target`}
                className="!w-3 !h-3 !opacity-0 !border-0 !pointer-events-none"
                style={{
                  left: 16,
                  top: '50%',
                  transform: 'translateY(-50%)',
                  pointerEvents: 'none',
                }}
                isConnectable={false}
              />
            )}

            <div className="flex items-center gap-2.5 flex-1">
              {getColumnIcon(referencedColumns.includes(column.columnName))}
              <span className="text-sm text-zinc-700 dark:text-neutral-300">
                {column.columnName}
              </span>
              {column.isPrimaryKey && (
                <Key className="w-3 h-3 text-zinc-500 dark:text-neutral-400" />
              )}
            </div>
            <div className="flex items-center gap-2.5">
              <div className="px-1.5 py-0.5 bg-gray-100 dark:bg-neutral-800 rounded flex items-center">
                <span className="text-xs font-medium text-zinc-700 dark:text-neutral-300">
                  {column.type}
                </span>
              </div>
              {/* Show white dot with outer circle for foreign key columns, gray circle for others */}
              {column.foreignKey ? (
                <div className="w-5 h-5 flex items-center justify-center relative">
                  <Circle
                    className="w-5 h-5 text-zinc-950 dark:text-white fill-none stroke-current"
                    strokeWidth={1.5}
                  />
                  <div className="w-2 h-2 bg-zinc-950 dark:bg-white rounded-full absolute" />
                </div>
              ) : (
                <Circle className="w-5 h-5 text-gray-400 dark:text-neutral-700 fill-gray-100 dark:fill-neutral-800 stroke-current" />
              )}
            </div>
          </div>
        ))}

        {/* Empty state */}
        {!table.columns.length && (
          <div className="flex items-center justify-center p-6">
            <div className="text-center">
              <Database className="w-6 h-6 text-gray-400 dark:text-neutral-600 mx-auto mb-2" />
              <p className="text-xs text-gray-500 dark:text-neutral-500">No columns defined</p>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
