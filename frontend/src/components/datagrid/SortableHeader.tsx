import type { DataGridColumn } from '@/lib/types/datagridTypes';
import { TypeBadge } from '@/components/TypeBadge';
import { ArrowDownWideNarrow, ArrowUpNarrowWide } from 'lucide-react';

function SortableHeaderRenderer({
  column,
  sortDirection,
  columnType,
  showTypeBadge,
  mutedHeader,
}: {
  column: DataGridColumn;
  sortDirection?: 'ASC' | 'DESC';
  columnType?: string;
  showTypeBadge?: boolean;
  mutedHeader?: boolean;
}) {
  // Determine which arrow to show on hover based on current sort state
  const getNextSortDirection = () => {
    if (!sortDirection) {
      return 'DESC'; // Default to DESC for first sort
    } else if (sortDirection === 'ASC') {
      return null;
    } else {
      return 'ASC';
    }
  };

  const nextDirection = getNextSortDirection();

  return (
    <div className="group w-full h-full flex items-center cursor-pointer">
      <div className="flex flex-row gap-1 items-center">
        <span
          className={`truncate text-sm font-medium ${mutedHeader ? 'text-zinc-500 dark:text-neutral-400' : 'text-zinc-950 dark:text-zinc-300'} max-w-[120px]`}
          title={typeof column.name === 'string' ? column.name : ''}
        >
          {column.name}
        </span>

        {columnType && showTypeBadge && (
          <TypeBadge type={columnType} className="dark:bg-neutral-800" />
        )}

        {/* Show sort arrow with hover effect */}
        {column.sortable && (
          <div className="relative ml-0.5 w-5 h-5">
            {sortDirection && (
              <div className="bg-transparent p-0.5 rounded">
                {sortDirection === 'DESC' ? (
                  <ArrowDownWideNarrow className="h-4 w-4 text-zinc-500 dark:text-neutral-400 transition-opacity group-hover:opacity-0" />
                ) : (
                  <ArrowUpNarrowWide className="h-4 w-4 text-zinc-500 dark:text-neutral-400 transition-opacity group-hover:opacity-0" />
                )}
              </div>
            )}

            {nextDirection && (
              <div className="absolute inset-0 invisible group-hover:visible transition-opacity bg-slate-200 border border-slate-200 dark:bg-neutral-800 dark:border-neutral-800 p-0.5 rounded w-5 h-5">
                {nextDirection === 'DESC' ? (
                  <ArrowDownWideNarrow className="h-4 w-4 text-zinc-500 dark:text-neutral-400" />
                ) : (
                  <ArrowUpNarrowWide className="h-4 w-4 text-zinc-500 dark:text-neutral-400" />
                )}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

export default SortableHeaderRenderer;
