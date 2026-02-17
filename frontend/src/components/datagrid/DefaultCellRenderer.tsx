import { ColumnType } from '@insforge/shared-schemas';
import type { ConvertedValue, DataGridRowType } from './datagridTypes';
import { RenderCellProps } from 'react-data-grid';
import { cn, formatValueForDisplay, isEmptyValue } from '@/lib/utils/utils';
import { Badge } from '@/components/radix/Badge';
import IdCell from './IdCell';

// Generic cell renderer factory
function createDefaultCellRenderer<TRow extends DataGridRowType>() {
  return {
    text: ({ row, column }: RenderCellProps<TRow>) => {
      const value = row[column.key] as ConvertedValue;
      const isNull = isEmptyValue(value);
      const displayValue = formatValueForDisplay(value, ColumnType.STRING);
      return (
        <div className="w-full h-full flex items-center">
          <span
            className={cn(
              'truncate',
              isNull ? 'text-muted-foreground italic pr-1' : 'dark:text-zinc-300'
            )}
            title={displayValue}
          >
            {displayValue}
          </span>
        </div>
      );
    },

    boolean: ({ row, column }: RenderCellProps<TRow>) => {
      const value = row[column.key] as ConvertedValue;
      const isNull = isEmptyValue(value);
      const displayValue = formatValueForDisplay(value, ColumnType.BOOLEAN);
      return (
        <div className="w-full h-full flex items-center justify-start">
          <Badge
            variant={isNull ? 'secondary' : value ? 'default' : 'secondary'}
            className={cn(
              'py-0.5 px-1.5 border border-transparent',
              isNull && 'text-muted-foreground italic'
            )}
          >
            {displayValue}
          </Badge>
        </div>
      );
    },

    datetime: ({ row, column }: RenderCellProps<TRow>) => {
      const value = row[column.key] as ConvertedValue;
      const isNull = isEmptyValue(value);
      const displayValue = formatValueForDisplay(value, ColumnType.DATETIME);
      const isError = displayValue === 'Invalid date time';

      return (
        <div className="w-full h-full flex items-center">
          <span
            className={cn(
              'truncate',
              isNull
                ? 'text-muted-foreground italic pr-1'
                : isError
                  ? 'text-red-500'
                  : 'text-black dark:text-zinc-300'
            )}
            title={displayValue}
          >
            {displayValue}
          </span>
        </div>
      );
    },

    date: ({ row, column }: RenderCellProps<TRow>) => {
      const value = row[column.key] as ConvertedValue;
      const isNull = isEmptyValue(value);
      const displayValue = formatValueForDisplay(value, ColumnType.DATE);
      const isError = displayValue === 'Invalid date';

      return (
        <div className="w-full h-full flex items-center">
          <span
            className={cn(
              'truncate',
              isNull
                ? 'text-muted-foreground italic pr-1'
                : isError
                  ? 'text-red-500'
                  : 'text-black dark:text-zinc-300'
            )}
            title={displayValue}
          >
            {displayValue}
          </span>
        </div>
      );
    },

    json: ({ row, column }: RenderCellProps<TRow>) => {
      const value = row[column.key] as ConvertedValue;
      const isNull = isEmptyValue(value);
      const displayText = formatValueForDisplay(value, ColumnType.JSON);
      const isError = displayText === 'Invalid JSON';

      return (
        <div className="w-full h-full flex items-center">
          <span
            className={cn(
              'truncate text-sm max-w-full overflow-hidden whitespace-nowrap',
              isNull
                ? 'text-muted-foreground italic pr-1'
                : isError
                  ? 'text-red-500'
                  : 'text-black dark:text-zinc-300'
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
      const isNull = isEmptyValue(value);
      const displayValue = formatValueForDisplay(value, ColumnType.STRING);
      return (
        <span
          className={cn(
            'text-sm truncate',
            isNull
              ? 'text-muted-foreground italic pr-1'
              : 'text-gray-800 font-medium dark:text-zinc-300'
          )}
          title={displayValue}
        >
          {displayValue}
        </span>
      );
    },
  };
}

// Export the factory function for custom types
export { createDefaultCellRenderer };
