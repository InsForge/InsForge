import { useState } from 'react';
import { UserPlus, Users, Key } from 'lucide-react';
import { Button, SearchInput, SelectionClearButton } from '@/components';
import { UsersManagement } from '@/features/auth/components/UsersManagement';
import { Tooltip, TooltipContent, TooltipProvider } from '@/components/radix/Tooltip';
import { UserFormDialog } from '@/features/auth/components/UserFormDialog';
import { OAuthConfiguration } from '@/features/auth/components/OAuthConfiguration';
import { ConfirmDialog } from '@/components/ConfirmDialog';
import { authService } from '@/features/auth/services/auth.service';
import { useToast } from '@/lib/hooks/useToast';
import { cn } from '@/lib/utils/utils';
import { useUsers } from '@/features/auth/hooks/useUsers';

export default function AuthenticationPage() {
  const [selectedSection, setSelectedSection] = useState<string>('users');
  const [searchQuery, setSearchQuery] = useState('');
  const [addDialogOpen, setAddDialogOpen] = useState(false);
  const [confirmDeleteOpen, setConfirmDeleteOpen] = useState(false);
  const [selectedRows, setSelectedRows] = useState<Set<string>>(new Set());

  const { showToast } = useToast();
  const { refetch } = useUsers();

  const handleBulkDelete = async () => {
    if (selectedRows.size === 0) {
      return;
    }

    try {
      const userIds = Array.from(selectedRows);
      await authService.deleteUsers(userIds);
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
      id: 'users',
      name: 'Users',
      icon: Users,
      description: 'Manage user accounts',
    },
    {
      id: 'auth-methods',
      name: 'Auth Methods',
      icon: Key,
      description: 'Configure authentication',
    },
  ];

  return (
    <div className="h-full bg-slate-50 flex flex-col overflow-hidden">
      {/* Tab Navigation */}
      <div className="h-12 flex items-center gap-6 px-6 border-b border-border-gray relative">
        {authSections.map((section) => (
          <button
            key={section.id}
            onClick={() => setSelectedSection(section.id)}
            className={cn(
              'flex h-full items-center gap-2 px-0 text-base font-semibold transition-colors relative',
              selectedSection === section.id ? 'text-black' : 'text-zinc-500 hover:text-zinc-700'
            )}
          >
            {section.name}
            {selectedSection === section.id && (
              <div className="absolute bottom-0 left-0 right-0 h-0.5 bg-black" />
            )}
          </button>
        ))}
      </div>

      {/* Content Area */}
      <div className="flex-1 flex flex-col overflow-hidden">
        {/* Users Section Header */}
        {selectedSection === 'users' && (
          <div className="px-6 py-3">
            <div className="flex items-center justify-between">
              {selectedRows.size > 0 ? (
                <div className="flex items-center gap-3">
                  <SelectionClearButton
                    selectedCount={selectedRows.size}
                    itemType="user"
                    onClear={() => setSelectedRows(new Set())}
                  />
                  <Button
                    variant="outline"
                    className="h-10 px-3 text-sm text-red-600 hover:text-red-600 hover:bg-zinc-50 border border-border-gray shadow-0"
                    onClick={() => setConfirmDeleteOpen(true)}
                  >
                    Delete {selectedRows.size === 1 ? 'User' : 'Users'}
                  </Button>
                </div>
              ) : (
                <SearchInput
                  value={searchQuery}
                  onChange={setSearchQuery}
                  placeholder="Search Users by Name or Email"
                  className="flex-1 max-w-80"
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
                      className="h-10 px-4 font-medium"
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

        {selectedSection === 'users' && (
          <UsersManagement
            searchQuery={searchQuery}
            selectedRows={selectedRows}
            onSelectedRowsChange={setSelectedRows}
            onAddUser={() => setAddDialogOpen(true)}
          />
        )}

        {selectedSection === 'auth-methods' && <OAuthConfiguration />}
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
