import { Pagination } from '@insforge/ui';

export interface PaginationControlsProps {
  currentPage?: number;
  totalPages?: number;
  onPageChange?: (page: number) => void;
  totalRecords?: number;
  pageSize?: number;
  recordLabel?: string;
}

export function PaginationControls({
  currentPage = 1,
  totalPages = 1,
  onPageChange,
  totalRecords = 0,
  pageSize = 50,
  recordLabel = 'results',
}: PaginationControlsProps) {
  return (
    <Pagination
      currentPage={currentPage}
      totalPages={totalPages}
      onPageChange={onPageChange}
      totalRecords={totalRecords}
      pageSize={pageSize}
      recordLabel={recordLabel}
    />
  );
}
