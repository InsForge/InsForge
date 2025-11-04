import { useState } from 'react';
import { useLocation } from 'react-router-dom';
import { UserPlus, Users, Key } from 'lucide-react';
import { Button, SearchInput, SelectionClearButton, DeleteActionButton } from '@/components';
import { UsersTab } from '@/features/auth/components/UsersTab';
import { Tooltip, TooltipContent, TooltipProvider } from '@/components/radix/Tooltip';
import { UserFormDialog } from '@/features/auth/components/UserFormDialog';
import { AuthMethodsTab } from '@/features/auth/components/AuthMethodsTab';
import { ConfigurationTab } from '@/features/auth/components/ConfigurationTab';
import { ConfirmDialog } from '@/components/ConfirmDialog';
import { useToast } from '@/lib/hooks/useToast';
import { cn } from '@/lib/utils/utils';
import { useUsers } from '@/features/auth/hooks/useUsers';
import { AuthTab } from '@/features/auth/helpers';

export default function AuthenticationPage() {
  const location = useLocation();
  const [selectedSection, setSelectedSection] = useState<string>(
    location.state?.initialTab || AuthTab.USERS
  );
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

  const authSections = [
    {
      id: AuthTab.USERS,
      name: 'Users',
      icon: Users,
      description: 'Manage user accounts',
    },
    {
      id: AuthTab.AUTH_METHODS,
      name: 'Auth Methods',
      icon: Key,
      description: 'Configure authentication methods',
    },
    {
      id: AuthTab.CONFIGURATION,
      name: 'Configuration',
      icon: Key,
      description: 'Configure authentication settings',
    },
  ];

  return (
    <div className="h-full bg-slate-50 dark:bg-neutral-800 flex flex-col overflow-hidden">
      {/* Tab Navigation */}
      <div className="h-12 flex items-center gap-6 px-6 border-b border-border-gray dark:border-neutral-700 relative">
        {authSections.map((section) => (
          <button
            key={section.id}
            onClick={() => setSelectedSection(section.id)}
            className={cn(
              'flex h-full items-center gap-2 px-0 text-base font-semibold transition-colors relative',
              selectedSection === section.id
                ? 'text-black dark:text-white'
                : 'text-zinc-500 hover:text-zinc-700 dark:text-zinc-400 dark:hover:text-zinc-300'
            )}
          >
            {section.name}
            {selectedSection === section.id && (
              <div className="absolute bottom-0 left-0 right-0 h-0.5 bg-black dark:bg-white" />
            )}
          </button>
        ))}
      </div>

      {/* Content Area */}
      <div className="flex-1 flex flex-col overflow-y-auto">
        {/* Users Section Header */}
        {selectedSection === AuthTab.USERS && (
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
        )}

        {/* Main Content */}

        {selectedSection === AuthTab.USERS && (
          <UsersTab
            searchQuery={searchQuery}
            selectedRows={selectedRows}
            onSelectedRowsChange={setSelectedRows}
          />
        )}

        {selectedSection === AuthTab.AUTH_METHODS && <AuthMethodsTab />}

        {selectedSection === AuthTab.CONFIGURATION && <ConfigurationTab />}
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
