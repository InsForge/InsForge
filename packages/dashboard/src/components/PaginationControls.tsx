import { Pagination } from '@insforge/ui';

export interface PaginationControlsProps {
  className?: string;
  currentPage?: number;
  totalPages?: number;
  onPageChange?: (page: number) => void;
  totalRecords?: number;
  pageSize?: number;
  pageSizeOptions?: number[];
  recordLabel?: string;
  onPageSizeChange?: (pageSize: number) => void;
}

export function PaginationControls({
  className,
  currentPage = 1,
  totalPages = 1,
  onPageChange,
  totalRecords = 0,
  pageSize = 50,
  pageSizeOptions,
  recordLabel = 'results',
  onPageSizeChange,
}: PaginationControlsProps) {
  return (
    <Pagination
      className={className}
      currentPage={currentPage}
      totalPages={totalPages}
      onPageChange={onPageChange}
      totalRecords={totalRecords}
      pageSize={pageSize}
      pageSizeOptions={pageSizeOptions}
      recordLabel={recordLabel}
      onPageSizeChange={onPageSizeChange}
    />
  );
}
