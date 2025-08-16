import { Handle, Position } from 'reactflow';
import { TableMetadata } from '@/features/metadata/services/metadata.service';
import { Database, Key, Hash } from 'lucide-react';

interface TableNodeProps {
  data: {
    table: TableMetadata;
  };
}

export function TableNode({ data }: TableNodeProps) {
  const { table } = data;

  const primaryKeys = table.columns.filter((col) => col.isPrimaryKey);
  const foreignKeys = table.columns.filter((col) => col.foreignKey);
  const regularColumns = table.columns.filter((col) => !col.isPrimaryKey && !col.foreignKey);

  return (
    <div className="bg-white rounded-lg shadow-lg border border-gray-200 min-w-[280px]">
      <Handle type="target" position={Position.Left} className="!bg-blue-500" />

      {/* Table Header */}
      <div className="px-4 py-3 bg-gradient-to-r from-blue-500 to-blue-600 text-white rounded-t-lg">
        <div className="flex items-center gap-2">
          <Database className="w-4 h-4" />
          <h3 className="font-semibold text-sm">{table.tableName}</h3>
        </div>
        {table.recordCount !== undefined && (
          <p className="text-xs text-blue-100 mt-1">{table.recordCount} records</p>
        )}
      </div>

      {/* Columns */}
      <div className="p-2 space-y-1 max-h-[400px] overflow-y-auto">
        {/* Primary Keys */}
        {primaryKeys.map((column) => (
          <div
            key={column.columnName}
            className="flex items-center gap-2 px-2 py-1 rounded hover:bg-yellow-50 transition-colors"
          >
            <Key className="w-3 h-3 text-yellow-600" />
            <span className="text-xs font-medium text-gray-900">{column.columnName}</span>
            <span className="text-xs text-gray-500 ml-auto">{column.type}</span>
          </div>
        ))}

        {/* Foreign Keys */}
        {foreignKeys.map((column) => (
          <div
            key={column.columnName}
            className="flex items-center gap-2 px-2 py-1 rounded hover:bg-blue-50 transition-colors"
          >
            <Hash className="w-3 h-3 text-blue-600" />
            <span className="text-xs font-medium text-gray-900">{column.columnName}</span>
            <span className="text-xs text-gray-500 ml-auto">{column.type}</span>
            {column.foreignKey && (
              <span
                className="text-xs text-blue-600"
                title={`→ ${column.foreignKey.referenceTable}.${column.foreignKey.referenceColumn}`}
              >
                FK
              </span>
            )}
          </div>
        ))}

        {/* Regular Columns */}
        {regularColumns.map((column) => (
          <div
            key={column.columnName}
            className="flex items-center gap-2 px-2 py-1 rounded hover:bg-gray-50 transition-colors"
          >
            <div className="w-3 h-3" />
            <span className="text-xs text-gray-700">{column.columnName}</span>
            <span className="text-xs text-gray-500 ml-auto">{column.type}</span>
            {!column.isNullable && (
              <span className="text-xs text-red-500" title="Not Null">
                *
              </span>
            )}
          </div>
        ))}
      </div>

      <Handle type="source" position={Position.Right} className="!bg-blue-500" />
    </div>
  );
}
