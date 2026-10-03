import { render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { OAuthConfigDialog } from '#features/auth/components/OAuthConfigDialog';
import { oauthProviders } from '#features/auth/helpers';

const hookMocks = vi.hoisted(() => ({
  providerConfig: undefined as Record<string, unknown> | undefined,
  createConfig: vi.fn(),
  updateConfig: vi.fn(),
}));

vi.mock('#features/auth/hooks/useOAuthConfig', () => ({
  useOAuthConfig: () => ({
    providerConfig: hookMocks.providerConfig,
    createConfig: hookMocks.createConfig,
    updateConfig: hookMocks.updateConfig,
    isCreating: false,
    isUpdating: false,
    isLoadingProvider: false,
  }),
}));

vi.mock('#lib/utils/utils', async (importOriginal) => {
  const actual = await importOriginal<typeof import('#lib/utils/utils')>();
  return { ...actual, isInsForgeCloudProject: () => true };
});

const xProvider = oauthProviders.find((provider) => provider.id === 'x');

describe('OAuthConfigDialog shared keys', () => {
  afterEach(() => {
    hookMocks.createConfig.mockReset();
    hookMocks.updateConfig.mockReset();
    hookMocks.providerConfig = undefined;
  });

  // #2053: X is no longer offered shared keys, so a stored config that still carries
  // the flag must open on the credential fields the admin needs to repair it.
  it('drops a stale shared-key flag when editing an X config', async () => {
    hookMocks.providerConfig = {
      provider: 'x',
      clientId: '',
      useSharedKey: true,
    };

    render(<OAuthConfigDialog provider={xProvider} mode="edit" isOpen onClose={vi.fn()} />);

    await waitFor(() => {
      expect(screen.getByText('Client ID')).toBeInTheDocument();
    });
    expect(screen.getByText('Client Secret')).toBeInTheDocument();
    expect(screen.queryByText('Shared Keys')).not.toBeInTheDocument();
  });

  it('keeps the shared-key toggle for a provider the cloud proxies', async () => {
    hookMocks.providerConfig = {
      provider: 'google',
      clientId: '',
      useSharedKey: true,
    };
    const googleProvider = oauthProviders.find((provider) => provider.id === 'google');

    render(<OAuthConfigDialog provider={googleProvider} mode="edit" isOpen onClose={vi.fn()} />);

    await waitFor(() => {
      expect(screen.getByText('Shared Keys')).toBeInTheDocument();
    });
    expect(screen.queryByText('Client ID')).not.toBeInTheDocument();
  });
});
