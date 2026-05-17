import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { UserFormDialog } from '#features/auth/components/UserFormDialog';

const hookMocks = vi.hoisted(() => ({
  refetch: vi.fn(),
  register: vi.fn(),
  showToast: vi.fn(),
}));

vi.mock('#features/auth/hooks/useUsers', () => ({
  useUsers: () => ({
    refetch: hookMocks.refetch,
    register: hookMocks.register,
  }),
}));

vi.mock('#lib/hooks/useToast', () => ({
  useToast: () => ({
    showToast: hookMocks.showToast,
  }),
}));

describe('UserFormDialog', () => {
  afterEach(() => {
    hookMocks.refetch.mockReset();
    hookMocks.register.mockReset();
    hookMocks.showToast.mockReset();
  });

  it('submits a new user and closes the dialog on success', async () => {
    const user = userEvent.setup();
    const onOpenChange = vi.fn();
    hookMocks.register.mockResolvedValue(undefined);
    hookMocks.refetch.mockResolvedValue(undefined);

    render(<UserFormDialog open onOpenChange={onOpenChange} />);

    await user.type(screen.getByLabelText('Name'), 'Ada Lovelace');
    await user.type(screen.getByLabelText('Email'), 'ada@example.com');
    await user.type(screen.getByLabelText('Password'), 'correct-horse-battery-staple');
    await user.click(screen.getByRole('button', { name: 'Add' }));

    await waitFor(() => {
      expect(hookMocks.register).toHaveBeenCalledWith({
        name: 'Ada Lovelace',
        email: 'ada@example.com',
        password: 'correct-horse-battery-staple',
        autoConfirm: undefined,
      });
      expect(hookMocks.refetch).toHaveBeenCalledOnce();
      expect(onOpenChange).toHaveBeenCalledWith(false);
      expect(hookMocks.showToast).toHaveBeenCalledWith('User created successfully', 'success');
    });
  });
});
