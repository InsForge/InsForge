import { useState } from 'react';
import { UserPlus } from 'lucide-react';
import { Button, SearchInput, SelectionClearButton, DeleteActionButton } from '@/components';
import { UsersTab } from '@/features/auth/components/UsersTab';
import { Tooltip, TooltipContent, TooltipProvider } from '@/components/radix/Tooltip';
import { UserFormDialog } from '@/features/auth/components/UserFormDialog';
import { ConfirmDialog } from '@/components/ConfirmDialog';
import { useToast } from '@/lib/hooks/useToast';
import { useUsers } from '@/features/auth/hooks/useUsers';

export default function UsersPage() {
  const [searchQuery, setSearchQuery] = useState('');
  const [addDialogOpen, setAddDialogOpen] = useState(false);
  const [confirmDeleteOpen, setConfirmDeleteOpen] = useState(false);
  const [selectedRows, setSelectedRows] = useState<Set<string>>(new Set());

  const { showToast } = useToast();
  const { refetch, deleteUsers } = useUsers();

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

  return (
    <div className="h-full bg-slate-50 dark:bg-neutral-800 flex flex-col overflow-hidden">
      <div className="flex-1 flex flex-col overflow-y-auto">
        {/* Users Section Header */}
        <div className="px-3 py-4 dark:bg-neutral-800">
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
                placeholder="Search Users by Name or Email"
                className="flex-1 max-w-80 dark:bg-neutral-800 dark:text-white dark:border-neutral-700"
                debounceTime={300}
              />
            )}
            <div className="flex items-center gap-2">
              {selectedRows.size === 0 && (
                <>
                  <TooltipProvider>
                    <Tooltip>
                      <TooltipContent>
                        <p>Refresh</p>
                      </TooltipContent>
                    </Tooltip>
                  </TooltipProvider>
                  <Button
                    className="h-10 px-4 font-medium dark:bg-emerald-300 dark:text-black"
                    onClick={() => setAddDialogOpen(true)}
                  >
                    <UserPlus className="h-4 w-4 mr-2" />
                    New User
                  </Button>
                </>
              )}
            </div>
          </div>
        </div>

        {/* Main Content */}
        <UsersTab
          searchQuery={searchQuery}
          selectedRows={selectedRows}
          onSelectedRowsChange={setSelectedRows}
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
