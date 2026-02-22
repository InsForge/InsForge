import type { DataGridColumn, DataGridRowType } from './datagridTypes';
import { TypeBadge } from '@/components/TypeBadge';
import { ChevronDown, ChevronUp, ChevronsUpDown } from 'lucide-react';

function SortableHeaderRenderer<TRow extends DataGridRowType>({
  column,
  sortDirection,
  columnType,
  showTypeBadge,
  mutedHeader,
}: {
  column: DataGridColumn<TRow>;
  sortDirection?: 'ASC' | 'DESC';
  columnType?: string;
  showTypeBadge?: boolean;
  mutedHeader?: boolean;
}) {
  return (
    <div className="group flex h-full w-full items-center">
      <div className="flex min-w-0 items-center gap-1">
        <span
          className={
            mutedHeader
              ? 'truncate text-[13px] leading-[18px] text-muted-foreground opacity-80'
              : 'truncate text-[13px] leading-[18px] text-muted-foreground'
          }
          title={typeof column.name === 'string' ? column.name : ''}
        >
          {column.name}
        </span>

        {columnType && showTypeBadge && <TypeBadge type={columnType} />}

        {column.sortable && (
          <div className="ml-0.5 inline-flex h-4 w-4 items-center justify-center text-muted-foreground">
            {sortDirection === 'ASC' && <ChevronUp className="h-3.5 w-3.5" />}
            {sortDirection === 'DESC' && <ChevronDown className="h-3.5 w-3.5" />}
            {!sortDirection && (
              <ChevronsUpDown className="h-3.5 w-3.5 opacity-0 transition-opacity group-hover:opacity-100" />
            )}
          </div>
        )}
      </div>
    </div>
  );
}

export default SortableHeaderRenderer;
