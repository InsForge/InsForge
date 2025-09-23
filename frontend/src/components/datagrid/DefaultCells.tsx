import { ColumnType } from '@insforge/shared-schemas';
import type { ConvertedValue, DataGridRow, DataGridRowType } from './datagridTypes';
import { RenderCellProps } from 'react-data-grid';
import { cn, formatValueForDisplay } from '@/lib/utils/utils';
import { Badge } from '@/components/radix/Badge';
import IdCell from './IdCell';

// Generic cell renderers factory
function createDefaultCellRenderers<TRow extends DataGridRowType>() {
  return {
    text: ({ row, column }: RenderCellProps<TRow>) => {
      const value = row[column.key] as ConvertedValue;
      const displayValue = formatValueForDisplay(value, ColumnType.STRING);
      return (
        <div className="w-full h-full flex items-center">
          <span className="truncate dark:text-zinc-300" title={displayValue}>
            {displayValue}
          </span>
        </div>
      );
    },

    boolean: ({ row, column }: RenderCellProps<TRow>) => {
      const value = row[column.key] as ConvertedValue;
      const displayValue = formatValueForDisplay(value, ColumnType.BOOLEAN);
      return (
        <div className="w-full h-full flex items-center justify-start">
          <Badge
            variant={value ? 'default' : 'secondary'}
            className="py-0.5 px-1.5 border border-transparent"
          >
            {displayValue}
          </Badge>
        </div>
      );
    },

    datetime: ({ row, column }: RenderCellProps<TRow>) => {
      const value = row[column.key] as ConvertedValue;
      const displayValue = formatValueForDisplay(value, ColumnType.DATETIME);
      const isError = displayValue === 'Invalid date time';

      return (
        <div className="w-full h-full flex items-center">
          <span
            className={cn('truncate', isError ? 'text-red-500' : 'text-black dark:text-zinc-300')}
            title={displayValue}
          >
            {displayValue}
          </span>
        </div>
      );
    },

    date: ({ row, column }: RenderCellProps<TRow>) => {
      const value = row[column.key] as ConvertedValue;
      const displayValue = formatValueForDisplay(value, ColumnType.DATE);
      const isError = displayValue === 'Invalid date';

      return (
        <div className="w-full h-full flex items-center">
          <span
            className={cn('truncate', isError ? 'text-red-500' : 'text-black dark:text-zinc-300')}
            title={displayValue}
          >
            {displayValue}
          </span>
        </div>
      );
    },

    json: ({ row, column }: RenderCellProps<TRow>) => {
      const value = row[column.key] as ConvertedValue;
      const displayText = formatValueForDisplay(value, ColumnType.JSON);
      const isError = displayText === 'Invalid JSON';

      return (
        <div className="w-full h-full flex items-center">
          <span
            className={cn(
              'truncate text-sm text-black dark:text-zinc-300 max-w-full overflow-hidden whitespace-nowrap',
              isError ? 'text-red-500' : ''
            )}
            title={displayText}
          >
            {displayText}
          </span>
        </div>
      );
    },

    id: ({ row, column }: RenderCellProps<TRow>) => {
      const value = row[column.key];

      return <IdCell value={String(value)} />;
    },

    email: ({ row, column }: RenderCellProps<TRow>) => {
      const value = row[column.key] as ConvertedValue;
      const displayValue = formatValueForDisplay(value, ColumnType.STRING);
      return (
        <span
          className="text-sm text-gray-800 font-medium truncate dark:text-zinc-300"
          title={displayValue}
        >
          {displayValue}
        </span>
      );
    },
  };
}

// Default instance for backward compatibility
export const DefaultCellRenderers = createDefaultCellRenderers<DataGridRow>();

// Export the factory function for custom types
export { createDefaultCellRenderers };
