import { useMemo, useState } from 'react';
import { usePageSize } from '#lib/hooks/usePageSize';

export function useClientPagination<T>(rows: T[], scope: string) {
  const { pageSize, pageSizeOptions, onPageSizeChange } = usePageSize(scope);
  const [page, setPage] = useState(1);

  const totalRecords = rows.length;
  const totalPages = Math.max(1, Math.ceil(totalRecords / pageSize));
  // Clamp so a search that shrinks the set never strands us past the last page.
  const currentPage = Math.min(page, totalPages);

  const pageRows = useMemo(
    () => rows.slice((currentPage - 1) * pageSize, currentPage * pageSize),
    [rows, currentPage, pageSize]
  );

  return {
    pageRows,
    setCurrentPage: setPage,
    gridProps: {
      currentPage,
      totalPages,
      totalRecords,
      pageSize,
      pageSizeOptions,
      onPageChange: setPage,
      onPageSizeChange: (size: number) => {
        onPageSizeChange(size);
        setPage(1);
      },
    },
  };
}
