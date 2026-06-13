import { useEffect, useMemo, useState } from 'react';

export const PAYMENT_LIST_PAGE_SIZE = 25;

export function usePaymentClientPagination(totalRecords: number) {
  const [currentPage, setCurrentPage] = useState(1);
  const totalPages = useMemo(
    () => Math.max(1, Math.ceil(totalRecords / PAYMENT_LIST_PAGE_SIZE)),
    [totalRecords]
  );
  const safePage = Math.min(currentPage, totalPages);

  useEffect(() => {
    if (currentPage > totalPages) {
      setCurrentPage(totalPages);
    }
  }, [currentPage, totalPages]);

  const startIndex = (safePage - 1) * PAYMENT_LIST_PAGE_SIZE;

  return {
    currentPage: safePage,
    setCurrentPage,
    totalPages,
    pageSize: PAYMENT_LIST_PAGE_SIZE,
    startIndex,
    endIndex: startIndex + PAYMENT_LIST_PAGE_SIZE,
    showPagination: totalRecords > PAYMENT_LIST_PAGE_SIZE,
  };
}
