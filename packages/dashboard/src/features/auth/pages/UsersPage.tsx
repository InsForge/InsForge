import { useEffect, useMemo, useState } from 'react';
import { CirclePlus, RefreshCw } from 'lucide-react';
import {
  Button,
  ConfirmDialog,
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@insforge/ui';
import {
  DataGridEmptyState,
  SelectionClearButton,
  DeleteActionButton,
  TableHeader,
} from '#components';
import { UsersDataGrid, UserFormDialog } from '#features/auth/components';
import { SortColumn } from 'react-data-grid';
import { UserSchema } from '@insforge/shared-schemas';
import { useToast } from '#lib/hooks/useToast';
import { useUsers } from '#features/auth/hooks/useUsers';
import { usePageSize } from '#lib/hooks/usePageSize';

export default function UsersPage() {
  const [searchValue, setSearchValue] = useState('');
  const searchQuery = searchValue.trim();
  const [addDialogOpen, setAddDialogOpen] = useState(false);
  const [confirmDeleteOpen, setConfirmDeleteOpen] = useState(false);
  const [selectedRows, setSelectedRows] = useState<Set<string>>(new Set());
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [sortColumns, setSortColumns] = useState<SortColumn[]>([]);

  const { showToast } = useToast();
  const {
    pageSize,
    pageSizeOptions,
    onPageSizeChange: handlePageSizeChange,
  } = usePageSize('users');

  const {
    users,
    totalUsers,
    isLoading,
    currentPage,
    setCurrentPage,
    totalPages,
    refetch,
    deleteUsers,
  } = useUsers({ searchQuery, pageSize });

  useEffect(() => {
    setCurrentPage(1);
  }, [searchQuery, setCurrentPage]);

  // Listen for refresh events
  useEffect(() => {
    const handleRefreshEvent = () => {
      // Reset sorting columns
      setSortColumns([]);
      // Reset selected rows
      setSelectedRows(new Set());
      // Refetch data
      void refetch();
    };
    window.addEventListener('refreshUsers', handleRefreshEvent);
    return () => window.removeEventListener('refreshUsers', handleRefreshEvent);
  }, [refetch]);

  // Clear selection when page changes or search changes
  useEffect(() => {
    setSelectedRows(new Set());
  }, [currentPage, searchQuery]);

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

  const handleBulkDelete = async () => {
    if (selectedRows.size === 0) {
      return;
    }

    try {
      const userIds = Array.from(selectedRows);
      await deleteUsers(userIds);
      void refetch();
      setSelectedRows(new Set());
      showToast(
        `${userIds.length} user${userIds.length > 1 ? 's' : ''} deleted successfully`,
        'success'
      );
    } catch (error) {
      showToast(error instanceof Error ? error.message : 'Failed to delete users', 'error');
    }
  };

  const handleRefresh = async () => {
    setIsRefreshing(true);
    try {
      setSelectedRows(new Set());
      setSearchValue('');
      setCurrentPage(1);
      await refetch();
    } finally {
      setIsRefreshing(false);
    }
  };

  const emptyState = (
    <DataGridEmptyState
      message="No Users Found"
      action={{ label: 'Add User', onClick: () => setAddDialogOpen(true) }}
    />
  );

  return (
    <div className="flex h-full min-h-0 flex-col overflow-hidden bg-[rgb(var(--semantic-1))]">
      <TableHeader
        leftContent={
          selectedRows.size > 0 ? (
            <div className="flex items-center gap-2">
              <SelectionClearButton
                selectedCount={selectedRows.size}
                itemType="user"
                onClear={() => setSelectedRows(new Set())}
              />
              <DeleteActionButton
                selectedCount={selectedRows.size}
                itemType="user"
                onDelete={() => setConfirmDeleteOpen(true)}
              />
            </div>
          ) : (
            <div className="flex min-w-0 items-center gap-3">
              <h1 className="shrink-0 text-base font-medium leading-7 text-foreground">Users</h1>
              <div className="flex h-5 w-5 shrink-0 items-center justify-center">
                <div className="h-5 w-px bg-[var(--alpha-8)]" />
              </div>
              <TooltipProvider>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Button
                      variant="ghost"
                      size="icon"
                      onClick={() => void handleRefresh()}
                      disabled={isRefreshing}
                      className="h-8 w-8 rounded p-1.5 text-muted-foreground hover:bg-[var(--alpha-4)] active:bg-[var(--alpha-8)]"
                    >
                      <RefreshCw
                        className={
                          isRefreshing
                            ? 'h-5 w-5 animate-spin stroke-[1.5]'
                            : 'h-5 w-5 stroke-[1.5]'
                        }
                      />
                    </Button>
                  </TooltipTrigger>
                  <TooltipContent side="bottom" align="center">
                    <p>{isRefreshing ? 'Refreshing...' : 'Refresh users'}</p>
                  </TooltipContent>
                </Tooltip>
              </TooltipProvider>
              <div className="flex h-5 w-5 shrink-0 items-center justify-center">
                <div className="h-5 w-px bg-[var(--alpha-8)]" />
              </div>
              <Button
                variant="ghost"
                size="sm"
                className="h-8 rounded px-1.5 text-primary hover:bg-[var(--alpha-4)] hover:text-primary active:bg-[var(--alpha-8)]"
                onClick={() => setAddDialogOpen(true)}
              >
                <CirclePlus className="h-6 w-6 stroke-[1.5] text-primary" />
                <span className="px-1 text-sm font-medium leading-5">Add User</span>
              </Button>
            </div>
          )
        }
        searchValue={searchValue}
        onSearchChange={setSearchValue}
        searchDebounceTime={300}
        searchPlaceholder="Search users"
      />

      <div className="relative min-h-0 flex-1">
        <UsersDataGrid
          data={sortedUsers}
          loading={isLoading}
          isRefreshing={isRefreshing}
          selectedRows={selectedRows}
          onSelectedRowsChange={setSelectedRows}
          sortColumns={sortColumns}
          onSortColumnsChange={setSortColumns}
          currentPage={currentPage}
          totalPages={totalPages}
          pageSize={pageSize}
          pageSizeOptions={pageSizeOptions}
          totalRecords={totalUsers}
          onPageChange={(page) => setCurrentPage(page)}
          onPageSizeChange={(newSize) => {
            handlePageSizeChange(newSize);
            setCurrentPage(1);
          }}
          emptyState={emptyState}
        />
      </div>

      <UserFormDialog open={addDialogOpen} onOpenChange={setAddDialogOpen} />

      <ConfirmDialog
        open={confirmDeleteOpen}
        onOpenChange={setConfirmDeleteOpen}
        title={`Delete ${selectedRows.size} ${selectedRows.size === 1 ? 'User' : 'Users'}`}
        description={
          <span>
            Are you sure to <strong>permanently delete {selectedRows.size}</strong>{' '}
            {selectedRows.size === 1 ? 'user' : 'users'}? This action cannot be undone.
          </span>
        }
        confirmText="Delete"
        cancelText="Cancel"
        destructive
        onConfirm={handleBulkDelete}
      />
    </div>
  );
}
