import { useEffect, useMemo, useState } from 'react';
import { useUsers } from '@/features/auth/hooks/useUsers';
import { UsersDataGrid } from './UsersDataGrid';
import { SortColumn } from 'react-data-grid';
import { UserSchema } from '@insforge/shared-schemas';

interface UsersTabProps {
  searchQuery?: string;
  selectedRows?: Set<string>;
  onSelectedRowsChange?: (selectedRows: Set<string>) => void;
  onAddUser?: () => void;
}

export function UsersTab({
  searchQuery: externalSearchQuery = '',
  selectedRows: externalSelectedRows,
  onSelectedRowsChange: externalOnSelectedRowsChange,
  onAddUser,
}: UsersTabProps) {
  // Default page size of 20 records per page
  const pageSize = 20;
  const { users, totalUsers, isLoading, currentPage, setCurrentPage, totalPages, refetch } =
    useUsers({ searchQuery: externalSearchQuery, pageSize });

  // Multi-select state - use external state if provided, otherwise internal
  const [internalSelectedRows, setInternalSelectedRows] = useState<Set<string>>(new Set());
  const selectedRows = externalSelectedRows || internalSelectedRows;
  const setSelectedRows = externalOnSelectedRowsChange || setInternalSelectedRows;

  // Sorting state
  const [sortColumns, setSortColumns] = useState<SortColumn[]>([]);

  // Listen for refresh events
  useEffect(() => {
    const handleRefresh = () => {
      // Reset sorting columns
      setSortColumns([]);
      // Reset selected rows
      setSelectedRows(new Set());
      // Refetch data
      void refetch();
    };
    window.addEventListener('refreshUsers', handleRefresh);
    return () => window.removeEventListener('refreshUsers', handleRefresh);
  }, [refetch, setSelectedRows]);

  // Clear selection when page changes or search changes
  useEffect(() => {
    setSelectedRows(new Set());
  }, [currentPage, externalSearchQuery, setSelectedRows]);

  // Apply sorting to users data
  const sortedUsers = useMemo(() => {
    if (!sortColumns.length) {
      return users;
    }

    return [...users].sort((a, b) => {
      for (const sort of sortColumns) {
        const { columnKey, direction } = sort;
        let aVal = a[columnKey as keyof UserSchema];
        let bVal = b[columnKey as keyof UserSchema];

        // Handle null/undefined values
        if ((aVal === null || aVal === undefined) && (bVal === null || bVal === undefined)) {
          continue;
        }
        if (aVal === null || aVal === undefined) {
          return direction === 'ASC' ? -1 : 1;
        }
        if (bVal === null || bVal === undefined) {
          return direction === 'ASC' ? 1 : -1;
        }

        // Convert to comparable values
        if (typeof aVal === 'string') {
          aVal = aVal.toLowerCase();
        }
        if (typeof bVal === 'string') {
          bVal = bVal.toLowerCase();
        }

        if (aVal < bVal) {
          return direction === 'ASC' ? -1 : 1;
        }
        if (aVal > bVal) {
          return direction === 'ASC' ? 1 : -1;
        }
      }
      return 0;
    });
  }, [users, sortColumns]);

  return (
    <div className="relative flex-1 flex flex-col overflow-hidden">
      <div className="flex-1 flex flex-col overflow-hidden">
        <UsersDataGrid
          data={sortedUsers}
          loading={isLoading}
          selectedRows={selectedRows}
          onSelectedRowsChange={setSelectedRows}
          sortColumns={sortColumns}
          onSortColumnsChange={setSortColumns}
          searchQuery={externalSearchQuery}
          currentPage={currentPage}
          totalPages={totalPages}
          pageSize={pageSize}
          totalRecords={totalUsers}
          onPageChange={setCurrentPage}
          emptyStateTitle="No users found"
          emptyStateDescription={
            externalSearchQuery
              ? 'No users match your search criteria'
              : 'Get started by adding your first user'
          }
          emptyStateActionText={!externalSearchQuery && onAddUser ? 'Add User' : undefined}
          onEmptyStateAction={!externalSearchQuery && onAddUser ? onAddUser : undefined}
        />
      </div>
    </div>
  );
}
