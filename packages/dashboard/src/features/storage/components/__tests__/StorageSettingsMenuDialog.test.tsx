import { render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import '#lib/i18n';
import { StorageSettingsMenuDialog } from '#features/storage/components/StorageSettingsMenuDialog';
import type { S3GatewayConfigSchema } from '@insforge/shared-schemas';

const storageSettingsMocks = vi.hoisted(() => ({
  isCloudProject: false,
  gatewayConfig: undefined as
    | { endpoint: string; region: string; available: boolean }
    | undefined,
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
    isLoading: false,
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

// The panel pulls in its own hooks/services; the dialog's tab gating is what
// this suite covers, so stub the panel body.
vi.mock('#features/storage/components/S3SettingsPanel', () => ({
  S3SettingsPanel: () => <div data-testid="s3-settings-panel" />,
}));

describe('StorageSettingsMenuDialog — S3 tab gating', () => {
  afterEach(() => {
    storageSettingsMocks.isCloudProject = false;
    storageSettingsMocks.gatewayConfig = undefined;
    storageSettingsMocks.updateConfig.mockReset();
  });

  const renderDialog = () =>
    render(<StorageSettingsMenuDialog open={true} onOpenChange={() => {}} />);

  it('shows the S3 tab on self-hosted when the backend reports the gateway available', () => {
    storageSettingsMocks.gatewayConfig = {
      endpoint: 'http://localhost:7130/storage/v1/s3',
      region: 'us-east-1',
      available: true,
    };
    renderDialog();
    expect(screen.getByText('S3 Configuration')).toBeInTheDocument();
  });

  it('hides the S3 tab on self-hosted when the gateway is unavailable (local storage)', () => {
    storageSettingsMocks.gatewayConfig = {
      endpoint: 'http://localhost:7130/storage/v1/s3',
      region: 'us-east-2',
      available: false,
    };
    renderDialog();
    expect(screen.queryByText('S3 Configuration')).not.toBeInTheDocument();
  });

  it('hides the S3 tab on self-hosted when the config query has no data (fails closed)', () => {
    storageSettingsMocks.gatewayConfig = undefined;
    renderDialog();
    expect(screen.queryByText('S3 Configuration')).not.toBeInTheDocument();
  });

  it('keeps the S3 tab visible on cloud regardless of the config query', () => {
    storageSettingsMocks.isCloudProject = true;
    storageSettingsMocks.gatewayConfig = undefined;
    renderDialog();
    expect(screen.getByText('S3 Configuration')).toBeInTheDocument();
  });
});
