import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const hookMocks = vi.hoisted(() => ({
  mutateAsync: vi.fn(),
  isPending: false,
}));

vi.mock('#features/ai/hooks/useModelGatewayConfig', () => ({
  useModelGatewayConfig: () => ({
    data: {
      apiKey: {
        configured: true,
        maskedKey: 'sk-or-en••••••••1234',
      },
      managementKey: {
        configured: false,
        maskedKey: null,
      },
    },
    isLoading: false,
    isError: false,
  }),
  useUpdateModelGatewayConfig: () => ({
    mutateAsync: hookMocks.mutateAsync,
    isPending: hookMocks.isPending,
  }),
}));

import { ModelGatewaySettingsDialog } from '#features/ai/components/ModelGatewaySettingsDialog';

describe('ModelGatewaySettingsDialog', () => {
  beforeEach(() => {
    hookMocks.mutateAsync.mockReset();
    hookMocks.mutateAsync.mockResolvedValue({});
    hookMocks.isPending = false;
  });

  it('allows both credentials to be replaced from the dashboard', async () => {
    const user = userEvent.setup();
    const onOpenChange = vi.fn();

    render(<ModelGatewaySettingsDialog open={true} onOpenChange={onOpenChange} />);

    expect(screen.getByLabelText('OpenRouter API key')).toBeEnabled();
    expect(screen.queryByText('Secret store')).not.toBeInTheDocument();

    await user.type(screen.getByLabelText('OpenRouter API key'), 'sk-or-api-test');
    await user.type(
      screen.getByLabelText('OpenRouter management API key'),
      'sk-or-management-test'
    );
    await user.click(screen.getByRole('button', { name: 'Save' }));

    expect(hookMocks.mutateAsync).toHaveBeenCalledWith({
      apiKey: 'sk-or-api-test',
      managementKey: 'sk-or-management-test',
    });
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });
});
