import { Pagination } from '@insforge/ui';
import { useTranslation } from 'react-i18next';

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
  recordLabel,
  onPageSizeChange,
}: PaginationControlsProps) {
  const { t } = useTranslation('chrome');
  const label = recordLabel ?? t('common.results', { defaultValue: 'results' });
  const normalizedTotalPages = Math.max(1, totalPages);
  const normalizedCurrentPage = Math.min(Math.max(currentPage, 1), normalizedTotalPages);
  const startRecord = totalRecords === 0 ? 0 : (normalizedCurrentPage - 1) * pageSize + 1;
  const endRecord =
    totalRecords === 0 ? 0 : Math.min(normalizedCurrentPage * pageSize, totalRecords);

  return (
    <Pagination
      className={className}
      currentPage={currentPage}
      totalPages={totalPages}
      onPageChange={onPageChange}
      totalRecords={totalRecords}
      pageSize={pageSize}
      pageSizeOptions={pageSizeOptions}
      recordLabel={label}
      // The UI package has no i18n runtime, so the sentences are rendered here.
      summaryText={t('common.paginationSummary', {
        start: startRecord,
        end: endRecord,
        total: totalRecords,
        label,
        defaultValue: 'Showing {{start}} to {{end}} of {{total}} {{label}}',
      })}
      pageSizeLabel={t('common.paginationPageSize', {
        label: label.charAt(0).toUpperCase() + label.slice(1),
        defaultValue: '{{label}} per page:',
      })}
      onPageSizeChange={onPageSizeChange}
    />
  );
}
