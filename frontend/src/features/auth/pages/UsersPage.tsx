import { useEffect, useMemo, useState } from 'react';
import { CirclePlus, RefreshCw, Search } from 'lucide-react';
import {
  Button,
  Input,
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@insforge/ui';
import { ConnectCTA, SelectionClearButton, DeleteActionButton, ConfirmDialog } from '@/components';
import { UsersDataGrid, UserFormDialog } from '@/features/auth/components';
import { SortColumn } from 'react-data-grid';
import { UserSchema } from '@insforge/shared-schemas';
import { useToast } from '@/lib/hooks/useToast';
import { useUsers } from '@/features/auth/hooks/useUsers';

export default function UsersPage() {
  const [searchQuery, setSearchQuery] = useState('');
  const [searchValue, setSearchValue] = useState('');
  const [addDialogOpen, setAddDialogOpen] = useState(false);
  const [confirmDeleteOpen, setConfirmDeleteOpen] = useState(false);
  const [selectedRows, setSelectedRows] = useState<Set<string>>(new Set());
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [sortColumns, setSortColumns] = useState<SortColumn[]>([]);

  const { showToast } = useToast();

  // Default page size of 20 records per page
  const pageSize = 20;
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
    const timeoutId = window.setTimeout(() => {
      const nextQuery = searchValue.trim();
      if (nextQuery !== searchQuery) {
        setCurrentPage(1);
        setSearchQuery(nextQuery);
      }
    }, 300);

    return () => window.clearTimeout(timeoutId);
  }, [searchValue, searchQuery, setCurrentPage]);

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
      setSearchQuery('');
      setCurrentPage(1);
      await refetch();
    } finally {
      setIsRefreshing(false);
    }
  };

  const emptyState = (
    <div className="text-sm text-foreground">
      {searchQuery ? 'No users match your search criteria' : 'No users found'}. <ConnectCTA />
    </div>
  );

  return (
    <div className="flex h-full min-h-0 flex-col overflow-hidden bg-[rgb(var(--semantic-1))]">
      <div className="flex h-12 shrink-0 items-center justify-between border-b border-[var(--alpha-8)] bg-[rgb(var(--semantic-0))] px-3">
        <div className="flex min-w-0 items-center gap-1">
          {selectedRows.size > 0 ? (
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
            <>
              <h1 className="text-base font-medium leading-7 text-foreground">Users</h1>
              <div className="mx-2 h-5 w-px bg-[var(--alpha-8)]" />
              <TooltipProvider>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Button
                      variant="ghost"
                      size="icon-sm"
                      onClick={() => void handleRefresh()}
                      disabled={isRefreshing}
                      className="text-muted-foreground"
                    >
                      <RefreshCw className={isRefreshing ? 'h-4 w-4 animate-spin' : 'h-4 w-4'} />
                    </Button>
                  </TooltipTrigger>
                  <TooltipContent side="bottom" align="center">
                    <p>{isRefreshing ? 'Refreshing...' : 'Refresh users'}</p>
                  </TooltipContent>
                </Tooltip>
              </TooltipProvider>
              <Button
                variant="ghost"
                size="sm"
                className="h-8 px-2 text-primary hover:text-primary"
                onClick={() => setAddDialogOpen(true)}
              >
                <CirclePlus className="h-4 w-4 text-primary" />
                Add User
              </Button>
            </>
          )}
        </div>
        <div className="relative w-[280px] max-w-full">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={searchValue}
            onChange={(event) => setSearchValue(event.target.value)}
            placeholder="Search users"
            className="h-8 border-[var(--alpha-12)] bg-[var(--alpha-4)] pl-8 pr-2 text-[13px] leading-[18px]"
          />
        </div>
      </div>

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
          totalRecords={totalUsers}
          onPageChange={setCurrentPage}
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
