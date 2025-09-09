import { ColumnType } from '@insforge/shared-schemas';
import type { DataGridRow, RenderCellProps } from '@/components/datagrid';
import { cn, formatValueForDisplay } from '@/lib/utils/utils';
import { Badge } from '@/components/radix/Badge';
import IdCell from './IdCell';

export const DefaultCellRenderers = {
  text: ({ row, column }: RenderCellProps<DataGridRow>) => {
    const value = row[column.key];
    const displayValue = formatValueForDisplay(value, ColumnType.STRING);
    return (
      <div className="w-full h-full flex items-center">
        <span className="truncate dark:text-zinc-300" title={displayValue}>
          {displayValue}
        </span>
      </div>
    );
  },

  boolean: ({ row, column }: RenderCellProps<DataGridRow>) => {
    const value = row[column.key];
    const displayValue = formatValueForDisplay(value, ColumnType.BOOLEAN);
    return (
      <div className="w-full h-full flex items-center justify-start">
        <Badge
          variant={value ? 'default' : 'secondary'}
          className="px-1.5 py-0.5 border border-transparent dark:bg-neutral-800 dark:text-zinc-300 dark:border-neutral-700"
        >
          {displayValue}
        </Badge>
      </div>
    );
  },

  date: ({ row, column }: RenderCellProps<DataGridRow>) => {
    const value = row[column.key];
    const displayValue = formatValueForDisplay(value, ColumnType.DATETIME);
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

  json: ({ row, column }: RenderCellProps<DataGridRow>) => {
    const value = row[column.key];
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

  id: ({ row, column }: RenderCellProps<DataGridRow>) => {
    const value = row[column.key];

    return <IdCell value={String(value)} />;
  },

  email: ({ row, column }: RenderCellProps<DataGridRow>) => {
    const value = row[column.key];
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
