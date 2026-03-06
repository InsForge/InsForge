import * as React from 'react';
import {
  ChevronLeft,
  ChevronRight,
  ChevronsLeft,
  ChevronsRight,
  MoreHorizontal,
} from 'lucide-react';
import { cn } from '../lib';

type PaginationItem = number | 'ellipsis-left' | 'ellipsis-right';
const FIXED_CENTER_SLOT_COUNT = 5;

export interface PaginationProps extends React.HTMLAttributes<HTMLDivElement> {
  currentPage?: number;
  totalPages?: number;
  totalRecords?: number;
  pageSize?: number;
  recordLabel?: string;
  visiblePageCount?: number;
  onPageChange?: (page: number) => void;
}

function clamp(value: number, min: number, max: number) {
  return Math.min(Math.max(value, min), max);
}

function getVisibleItems(
  currentPage: number,
  totalPages: number,
  centerSlotCount: number
): PaginationItem[] {
  const slots = Math.max(1, centerSlotCount);

  if (totalPages <= slots) {
    return Array.from({ length: totalPages }, (_, index) => index + 1);
  }

  // For 5 center slots:
  // start: 1 2 3 4 ...
  // middle: ... p-1 p p+1 ...
  // end: ... n-3 n-2 n-1 n
  const edgePageCount = slots - 1;
  const endStartPage = totalPages - edgePageCount + 1;

  if (currentPage <= edgePageCount) {
    return [...Array.from({ length: edgePageCount }, (_, index) => index + 1), 'ellipsis-right'];
  }

  if (currentPage >= totalPages - (edgePageCount - 1)) {
    return [
      'ellipsis-left',
      ...Array.from({ length: edgePageCount }, (_, index) => endStartPage + index),
    ];
  }

  return ['ellipsis-left', currentPage - 1, currentPage, currentPage + 1, 'ellipsis-right'];
}

export function Pagination({
  className,
  currentPage = 1,
  totalPages = 1,
  totalRecords = 0,
  pageSize = 100,
  recordLabel = 'users',
  visiblePageCount = FIXED_CENTER_SLOT_COUNT,
  onPageChange,
  ...props
}: PaginationProps) {
  const normalizedTotalPages = Math.max(1, totalPages);
  const normalizedCurrentPage = clamp(currentPage, 1, normalizedTotalPages);
  const startRecord = totalRecords === 0 ? 0 : (normalizedCurrentPage - 1) * pageSize + 1;
  const endRecord =
    totalRecords === 0 ? 0 : Math.min(normalizedCurrentPage * pageSize, totalRecords);

  // Keep pagination density consistent across the app:
  // 2 fixed controls on the left + 5 center slots + 2 fixed controls on the right = 9 total items.
  const enforcedCenterSlotCount = Math.max(
    FIXED_CENTER_SLOT_COUNT,
    Math.min(FIXED_CENTER_SLOT_COUNT, visiblePageCount)
  );

  const items = React.useMemo(
    () => getVisibleItems(normalizedCurrentPage, normalizedTotalPages, enforcedCenterSlotCount),
    [normalizedCurrentPage, normalizedTotalPages, enforcedCenterSlotCount]
  );

  const canGoBack = normalizedCurrentPage > 1;
  const canGoForward = normalizedCurrentPage < normalizedTotalPages;

  const handlePageChange = (page: number) => {
    const nextPage = clamp(page, 1, normalizedTotalPages);
    if (nextPage !== normalizedCurrentPage) {
      onPageChange?.(nextPage);
    }
  };

  return (
    <div
      className={cn(
        'relative flex items-center gap-3 border-t border-[var(--alpha-8)] bg-[rgb(var(--semantic-0))] px-4 py-2',
        className
      )}
      {...props}
    >
      <p className="min-w-0 flex-1 truncate text-[13px] leading-[18px] text-muted-foreground">
        Showing {startRecord} to {endRecord} of {totalRecords} {recordLabel}
      </p>
      <nav className="flex items-center gap-1" aria-label="Pagination">
        <button
          type="button"
          aria-label="Go to first page"
          disabled={!canGoBack}
          onClick={() => handlePageChange(1)}
          className={cn(
            'inline-flex h-9 w-9 items-center justify-center rounded p-1.5 text-muted-foreground transition-colors',
            'hover:bg-[var(--alpha-4)] active:bg-[var(--alpha-8)]',
            'focus-visible:outline-none focus-visible:bg-[var(--alpha-4)]',
            'disabled:pointer-events-none disabled:opacity-40'
          )}
        >
          <ChevronsLeft className="h-6 w-6 stroke-[1.5]" />
        </button>
        <button
          type="button"
          aria-label="Go to previous page"
          disabled={!canGoBack}
          onClick={() => handlePageChange(normalizedCurrentPage - 1)}
          className={cn(
            'inline-flex h-9 w-9 items-center justify-center rounded p-1.5 text-muted-foreground transition-colors',
            'hover:bg-[var(--alpha-4)] active:bg-[var(--alpha-8)]',
            'focus-visible:outline-none focus-visible:bg-[var(--alpha-4)]',
            'disabled:pointer-events-none disabled:opacity-40'
          )}
        >
          <ChevronLeft className="h-6 w-6 stroke-[1.5]" />
        </button>
        {items.map((item) => {
          if (typeof item !== 'number') {
            return (
              <span
                key={item}
                aria-hidden
                className="inline-flex h-9 w-9 items-center justify-center rounded p-1.5 text-muted-foreground"
              >
                <MoreHorizontal className="h-6 w-6 stroke-[1.5]" />
              </span>
            );
          }

          const isActive = item === normalizedCurrentPage;
          return (
            <button
              key={item}
              type="button"
              aria-label={`Go to page ${item}`}
              aria-current={isActive ? 'page' : undefined}
              onClick={() => handlePageChange(item)}
              className={cn(
                'inline-flex h-9 min-w-9 items-center justify-center rounded px-2.5 py-1.5 text-sm font-medium leading-5 transition-colors',
                'focus-visible:outline-none focus-visible:bg-[var(--alpha-4)]',
                isActive
                  ? 'bg-[var(--alpha-4)] text-foreground'
                  : 'text-muted-foreground hover:bg-[var(--alpha-4)] active:bg-[var(--alpha-8)]'
              )}
            >
              {item}
            </button>
          );
        })}
        <button
          type="button"
          aria-label="Go to next page"
          disabled={!canGoForward}
          onClick={() => handlePageChange(normalizedCurrentPage + 1)}
          className={cn(
            'inline-flex h-9 w-9 items-center justify-center rounded p-1.5 text-muted-foreground transition-colors',
            'hover:bg-[var(--alpha-4)] active:bg-[var(--alpha-8)]',
            'focus-visible:outline-none focus-visible:bg-[var(--alpha-4)]',
            'disabled:pointer-events-none disabled:opacity-40'
          )}
        >
          <ChevronRight className="h-6 w-6 stroke-[1.5]" />
        </button>
        <button
          type="button"
          aria-label="Go to last page"
          disabled={!canGoForward}
          onClick={() => handlePageChange(normalizedTotalPages)}
          className={cn(
            'inline-flex h-9 w-9 items-center justify-center rounded p-1.5 text-muted-foreground transition-colors',
            'hover:bg-[var(--alpha-4)] active:bg-[var(--alpha-8)]',
            'focus-visible:outline-none focus-visible:bg-[var(--alpha-4)]',
            'disabled:pointer-events-none disabled:opacity-40'
          )}
        >
          <ChevronsRight className="h-6 w-6 stroke-[1.5]" />
        </button>
      </nav>
    </div>
  );
}
