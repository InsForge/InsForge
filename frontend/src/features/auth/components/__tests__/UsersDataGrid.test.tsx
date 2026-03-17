import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { createUsersColumns } from '../UsersDataGrid';

const baseUser = {
  id: '8b0a99a2-2787-4e2a-9ef9-19e0d7ce7f67',
  email: 'member@example.com',
  emailVerified: true,
  isProjectAdmin: false,
  adminSource: 'user' as const,
  providers: ['email'],
  createdAt: '2026-03-01T00:00:00.000Z',
  updatedAt: '2026-03-01T00:00:00.000Z',
  profile: { name: 'Member Admin' },
  metadata: {},
};

describe('createUsersColumns', () => {
  it('renders bootstrap admin badge in the role column', () => {
    const columns = createUsersColumns();
    const roleColumn = columns.find((column) => column.key === 'isProjectAdmin');

    expect(roleColumn).toBeDefined();

    render(
      <>{roleColumn?.renderCell?.({ row: { ...baseUser, isProjectAdmin: true, adminSource: 'bootstrap' } } as never)}</>
    );

    expect(screen.getByText('Bootstrap Admin')).toBeInTheDocument();
  });

  it('adds an actions column when admin toggles are enabled', () => {
    const columns = createUsersColumns({ onToggleAdminStatus: () => undefined });
    const actionsColumn = columns.find((column) => column.key === 'actions');

    expect(actionsColumn).toMatchObject({
      key: 'actions',
      sortable: false,
    });

    render(<>{actionsColumn?.renderCell?.({ row: baseUser } as never)}</>);

    expect(screen.getByLabelText('Actions for member@example.com')).toBeInTheDocument();
  });
});
