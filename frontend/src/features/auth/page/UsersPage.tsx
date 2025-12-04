import { useState, useEffect, useMemo } from 'react';
import { UserPlus } from 'lucide-react';
import RefreshIcon from '@/assets/icons/refresh.svg?react';
import {
  Button,
  ConnectCTA,
  SearchInput,
  SelectionClearButton,
  DeleteActionButton,
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
  ConfirmDialog,
} from '@/components';
import { UsersDataGrid, UserFormDialog } from '@/features/auth/components';
import { SortColumn } from 'react-data-grid';
import { UserSchema, type SocketMessage } from '@insforge/shared-schemas';
import { useToast } from '@/lib/hooks/useToast';
import { useUsers } from '@/features/auth/hooks/useUsers';
import { DataUpdateResourceType, ServerEvents, useSocket } from '@/lib/contexts/SocketContext';

export default function UsersPage() {
  const [searchQuery, setSearchQuery] = useState('');
  const [addDialogOpen, setAddDialogOpen] = useState(false);
  const [confirmDeleteOpen, setConfirmDeleteOpen] = useState(false);
  const [selectedRows, setSelectedRows] = useState<Set<string>>(new Set());
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [sortColumns, setSortColumns] = useState<SortColumn[]>([]);

  const { socket, isConnected } = useSocket();

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

  useEffect(() => {
    if (!socket || !isConnected) {
      return;
    }

    const handleDataUpdate = (message: SocketMessage) => {
      if (message.resource === DataUpdateResourceType.USERS) {
        // Refetch data
        void refetch();
      }
    };

    socket.on(ServerEvents.DATA_UPDATE, handleDataUpdate);

    return () => {
      socket.off(ServerEvents.DATA_UPDATE, handleDataUpdate);
    };
  }, [socket, isConnected, refetch]);

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
      setSearchQuery('');
      await refetch();
    } finally {
      setIsRefreshing(false);
    }
  };

  const emptyState = (
    <div className="text-sm text-black dark:text-white">
      {searchQuery ? 'No users match your search criteria' : 'No users found'}. <ConnectCTA />
    </div>
  );

  return (
    <div className="h-full bg-slate-50 dark:bg-neutral-800 flex flex-col overflow-hidden">
      <div className="flex-1 flex flex-col overflow-y-auto">
        {/* Page Header with Title and Actions */}
        <div className="pl-4 pr-1.5 py-1.5 h-12 dark:bg-neutral-800">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <h1 className="text-base font-bold text-black dark:text-white">Users</h1>

              {/* Separator */}
              <div className="h-6 w-px bg-gray-200 dark:bg-neutral-700" />

              {/* Refresh button */}
              <TooltipProvider>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="p-1 h-9 w-9"
                      onClick={() => void handleRefresh()}
                      disabled={isRefreshing}
                    >
                      <RefreshIcon className="h-5 w-5 text-zinc-400 dark:text-neutral-400" />
                    </Button>
                  </TooltipTrigger>
                  <TooltipContent side="bottom" align="center">
                    <p>{isRefreshing ? 'Refreshing...' : 'Refresh'}</p>
                  </TooltipContent>
                </Tooltip>
              </TooltipProvider>
            </div>
          </div>
        </div>

        {/* Search Bar and Actions */}
        <div className="pt-2 pb-4 px-3 dark:bg-neutral-800">
          <div className="flex items-center justify-between">
            {selectedRows.size > 0 ? (
              <div className="flex items-center gap-3">
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
              <SearchInput
                value={searchQuery}
                onChange={setSearchQuery}
                placeholder="Search user"
                className="flex-1 max-w-80 dark:bg-neutral-800 dark:text-white dark:border-neutral-700"
                debounceTime={300}
              />
            )}
            <div className="flex items-center gap-2 ml-4">
              {selectedRows.size === 0 && (
                <Button
                  className="h-10 px-4 font-medium dark:bg-emerald-300 dark:text-black"
                  onClick={() => setAddDialogOpen(true)}
                >
                  <UserPlus className="h-4 w-4 mr-2" />
                  Add User
                </Button>
              )}
            </div>
          </div>
        </div>

        {/* Main Content */}
        <div className="relative flex-1 flex flex-col overflow-hidden">
          <div className="flex-1 flex flex-col overflow-hidden">
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
        </div>
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
