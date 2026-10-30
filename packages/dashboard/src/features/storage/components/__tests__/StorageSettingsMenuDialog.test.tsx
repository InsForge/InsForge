import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import '#lib/i18n';
import { StorageSettingsMenuDialog } from '#features/storage/components/StorageSettingsMenuDialog';
import type { S3GatewayConfigSchema } from '@insforge/shared-schemas';

const storageSettingsMocks = vi.hoisted(() => ({
  isCloudProject: false,
  gatewayConfig: undefined as { endpoint: string; region: string; available: boolean } | undefined,
  gatewayConfigLoading: false,
  // Stable reference — a fresh object per render would change resetForm's
  // identity every render and loop the dialog's reset effect.
  storageConfig: { maxFileSizeMb: 50 },
  updateConfig: vi.fn(),
}));

vi.mock('#features/storage/hooks/useStorageConfig', () => ({
  useStorageConfig: () => ({
    config: storageSettingsMocks.storageConfig,
    isLoading: false,
    error: null,
    isUpdating: false,
    updateConfig: storageSettingsMocks.updateConfig,
  }),
}));

vi.mock('#features/storage/hooks/useS3AccessKeys', () => ({
  useS3GatewayConfig: () => ({
    data: storageSettingsMocks.gatewayConfig as S3GatewayConfigSchema | undefined,
    isLoading: storageSettingsMocks.gatewayConfigLoading,
    error: null,
  }),
  useS3AccessKeys: () => ({
    keys: [],
    isLoading: false,
    error: null,
    refetch: vi.fn(),
    createAccessKey: vi.fn(),
    isCreating: false,
    deleteAccessKey: vi.fn(),
    isDeleting: false,
  }),
}));

vi.mock('#lib/utils/utils', () => ({
  isInsForgeCloudProject: () => storageSettingsMocks.isCloudProject,
}));

// The panel pulls in its own hooks/services; the dialog's tab behavior is what
// this suite covers, so stub the panel body.
vi.mock('#features/storage/components/S3SettingsPanel', () => ({
  S3SettingsPanel: () => <div data-testid="s3-settings-panel" />,
}));

describe('StorageSettingsMenuDialog — S3 tab', () => {
  afterEach(() => {
    storageSettingsMocks.isCloudProject = false;
    storageSettingsMocks.gatewayConfig = undefined;
    storageSettingsMocks.gatewayConfigLoading = false;
    storageSettingsMocks.updateConfig.mockReset();
  });

  const renderDialog = () =>
    render(<StorageSettingsMenuDialog open={true} onOpenChange={() => {}} />);

  const openS3Tab = async () => {
    await userEvent.click(screen.getByText('S3 Configuration'));
  };

  it('always shows the S3 tab, even on self-hosted local storage', () => {
    renderDialog();
    expect(screen.getByText('S3 Configuration')).toBeInTheDocument();
  });

  it('renders the panel when the backend reports the gateway available', async () => {
    storageSettingsMocks.gatewayConfig = {
      endpoint: 'http://localhost:7130/storage/v1/s3',
      region: 'us-east-1',
      available: true,
    };
    renderDialog();
    await openS3Tab();
    expect(screen.getByTestId('s3-settings-panel')).toBeInTheDocument();
  });

  it('renders the not-configured state when the gateway is unavailable (local storage)', async () => {
    storageSettingsMocks.gatewayConfig = {
      endpoint: 'http://localhost:7130/storage/v1/s3',
      region: 'us-east-2',
      available: false,
    };
    renderDialog();
    await openS3Tab();
    expect(screen.getByText('Storage backend not configured')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /self-hosted storage guide/i })).toHaveAttribute(
      'href',
      'https://docs.insforge.dev/deployment/self-host-storage'
    );
    expect(screen.queryByTestId('s3-settings-panel')).not.toBeInTheDocument();
  });

  it('fails closed to the not-configured state when the config query has no data', async () => {
    storageSettingsMocks.gatewayConfig = undefined;
    renderDialog();
    await openS3Tab();
    expect(screen.getByText('Storage backend not configured')).toBeInTheDocument();
    expect(screen.queryByTestId('s3-settings-panel')).not.toBeInTheDocument();
  });

  it('shows a loading state while the config query is in flight', async () => {
    storageSettingsMocks.gatewayConfigLoading = true;
    renderDialog();
    await openS3Tab();
    expect(screen.getByText('Loading configuration...')).toBeInTheDocument();
    expect(screen.queryByText('Storage backend not configured')).not.toBeInTheDocument();
  });

  it('renders the panel on cloud regardless of the config query', async () => {
    storageSettingsMocks.isCloudProject = true;
    storageSettingsMocks.gatewayConfig = undefined;
    renderDialog();
    await openS3Tab();
    expect(screen.getByTestId('s3-settings-panel')).toBeInTheDocument();
  });
});
