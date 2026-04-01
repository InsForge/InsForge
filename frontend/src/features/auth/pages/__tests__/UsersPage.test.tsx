import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import UsersPage from '../UsersPage';
import { useUsers } from '@/features/auth/hooks/useUsers';

vi.mock('@/features/auth/hooks/useUsers', () => ({
  useUsers: vi.fn(),
}));

vi.mock('@/lib/hooks/useToast', () => ({
  useToast: () => ({
    showToast: vi.fn(),
  }),
}));

vi.mock('@/lib/hooks/usePageSize', () => ({
  usePageSize: () => ({
    pageSize: 50,
    pageSizeOptions: [50, 100],
    onPageSizeChange: vi.fn(),
  }),
}));

vi.mock('@/components', () => ({
  DataGridEmptyState: () => null,
  SelectionClearButton: ({ selectedCount }: { selectedCount: number }) => (
    <div data-testid="selection-clear-count">{selectedCount}</div>
  ),
  DeleteActionButton: () => null,
  TableHeader: () => null,
}));

vi.mock('@/features/auth/components', () => ({
  UsersDataGrid: ({
    selectedRows,
    onSelectedRowsChange,
  }: {
    selectedRows: Set<string>;
    onSelectedRowsChange: (rows: Set<string>) => void;
  }) => (
    <div>
      <div data-testid="selected-rows-count">{selectedRows.size}</div>
      <button onClick={() => onSelectedRowsChange(new Set(['user-1']))}>select row</button>
    </div>
  ),
  UserFormDialog: () => null,
}));

vi.mock('@insforge/ui', () => ({
  Button: ({ children, ...props }: React.ButtonHTMLAttributes<HTMLButtonElement>) => (
    <button {...props}>{children}</button>
  ),
  ConfirmDialog: () => null,
  Tooltip: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  TooltipContent: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  TooltipProvider: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  TooltipTrigger: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));

const makeUser = (id: string) => ({
  id,
  email: `${id}@example.com`,
  emailVerified: true,
  isProjectAdmin: false,
  adminSource: 'user' as const,
  providers: ['email'],
  createdAt: '2026-03-01T00:00:00.000Z',
  updatedAt: '2026-03-01T00:00:00.000Z',
  profile: { name: id },
  metadata: {},
});

describe('UsersPage selection behavior', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('preserves selection across refetches when the visible user ids are unchanged', () => {
    let users = [makeUser('user-1'), makeUser('user-2')];

    vi.mocked(useUsers).mockImplementation(() => ({
      users,
      totalUsers: users.length,
      isLoading: false,
      error: null,
      currentPage: 1,
      setCurrentPage: vi.fn(),
      totalPages: 1,
      pageSize: 50,
      searchQuery: '',
      roleFilter: 'users',
      refetch: vi.fn(),
      getUser: vi.fn(),
      getCurrentUser: vi.fn(),
      register: vi.fn(),
      deleteUsers: vi.fn(),
      updateUserAdminStatus: vi.fn(),
      isRegistering: false,
      isDeleting: false,
      isUpdatingUserAdminStatus: false,
    }));

    const { rerender } = render(<UsersPage />);

    fireEvent.click(screen.getByRole('button', { name: 'select row' }));
    expect(screen.getByTestId('selected-rows-count')).toHaveTextContent('1');

    users = [makeUser('user-1'), makeUser('user-2')];
    rerender(<UsersPage />);

    expect(screen.getByTestId('selected-rows-count')).toHaveTextContent('1');
  });
});
