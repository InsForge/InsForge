import { fireEvent, render, screen } from '@testing-library/react';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createUsersColumns } from '../UsersDataGrid';

const originalResizeObserver = globalThis.ResizeObserver;
const originalGetBoundingClientRect = HTMLElement.prototype.getBoundingClientRect;

beforeAll(() => {
  class ResizeObserverMock {
    observe() {}
    disconnect() {}
  }

  Object.defineProperty(globalThis, 'ResizeObserver', {
    writable: true,
    configurable: true,
    value: ResizeObserverMock,
  });

  Object.defineProperty(HTMLElement.prototype, 'getBoundingClientRect', {
    writable: true,
    configurable: true,
    value: () => ({
      width: 240,
      height: 40,
      top: 0,
      left: 0,
      bottom: 40,
      right: 240,
      x: 0,
      y: 0,
      toJSON: () => ({}),
    }),
  });
});

afterAll(() => {
  Object.defineProperty(globalThis, 'ResizeObserver', {
    writable: true,
    configurable: true,
    value: originalResizeObserver,
  });

  Object.defineProperty(HTMLElement.prototype, 'getBoundingClientRect', {
    writable: true,
    configurable: true,
    value: originalGetBoundingClientRect,
  });
});

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
      <>
        {roleColumn?.renderCell?.({
          row: { ...baseUser, isProjectAdmin: true, adminSource: 'bootstrap' },
        } as never)}
      </>
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

  it('renders bootstrap admin actions with disabled affordances', () => {
    const columns = createUsersColumns({ onToggleAdminStatus: () => undefined });
    const actionsColumn = columns.find((column) => column.key === 'actions');

    render(
      <>
        {actionsColumn?.renderCell?.({
          row: { ...baseUser, isProjectAdmin: true, adminSource: 'bootstrap' },
        } as never)}
      </>
    );

    const trigger = screen.getByLabelText('Actions for member@example.com');
    fireEvent.click(trigger);

    expect(trigger).toHaveAttribute('aria-disabled', 'true');
    expect(trigger).toHaveClass('opacity-50');
    expect(trigger).toHaveClass('cursor-not-allowed');
    expect(screen.queryByText('Remove admin')).not.toBeInTheDocument();
  });

  it('renders custom provider labels while admin toggles are enabled', () => {
    const columns = createUsersColumns({
      customProviderLabels: { saml: 'Company SSO' },
      onToggleAdminStatus: () => undefined,
    });
    const providersColumn = columns.find((column) => column.key === 'providers');

    expect(providersColumn).toBeDefined();

    render(
      <>
        {providersColumn?.renderCell?.({
          row: { ...baseUser, providers: ['saml'] },
        } as never)}
      </>
    );

    expect(screen.getByText('Company SSO')).toBeInTheDocument();
  });
});
