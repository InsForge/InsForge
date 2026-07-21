import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import '#lib/i18n';
import { AuthSettingsMenuDialog } from '#features/auth/components/AuthSettingsMenuDialog';

const authSettingsMocks = vi.hoisted(() => ({
  authConfig: {
    id: '11111111-1111-4111-8111-111111111111',
    requireEmailVerification: false,
    passwordMinLength: 6,
    requireNumber: false,
    requireLowercase: false,
    requireUppercase: false,
    requireSpecialChar: false,
    verifyEmailMethod: 'code',
    resetPasswordMethod: 'code',
    allowedRedirectUrls: [],
    disableSignup: false,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
  },
  isCloudProject: false,
  smtpEnabled: false,
  showToast: vi.fn(),
  updateConfig: vi.fn(),
}));

vi.mock('#features/auth/hooks/useAuthConfig', () => ({
  useAuthConfig: () => ({
    config: authSettingsMocks.authConfig,
    isLoading: false,
    isUpdating: false,
    updateConfig: authSettingsMocks.updateConfig,
  }),
}));

vi.mock('#features/auth/hooks/useSmtpConfig', () => ({
  useSmtpConfig: () => ({
    config: { enabled: authSettingsMocks.smtpEnabled },
  }),
}));

vi.mock('#lib/utils/utils', () => ({
  isInsForgeCloudProject: () => authSettingsMocks.isCloudProject,
}));

vi.mock('@insforge/ui', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@insforge/ui')>();

  return {
    ...actual,
    useToast: () => ({
      showToast: authSettingsMocks.showToast,
    }),
  };
});

describe('AuthSettingsMenuDialog', () => {
  afterEach(() => {
    authSettingsMocks.isCloudProject = false;
    authSettingsMocks.smtpEnabled = false;
    authSettingsMocks.showToast.mockReset();
    authSettingsMocks.updateConfig.mockReset();
  });

  it('shows email verification settings for self-hosted projects with SMTP enabled', async () => {
    const user = userEvent.setup();
    authSettingsMocks.smtpEnabled = true;

    render(<AuthSettingsMenuDialog open onOpenChange={vi.fn()} />);

    await user.click(screen.getByRole('button', { name: 'Email Verification' }));

    expect(screen.getByText('Require Email Verification')).toBeInTheDocument();
    expect(screen.getByRole('switch')).toBeInTheDocument();
  });

  it('hides email verification settings for self-hosted projects without SMTP', () => {
    render(<AuthSettingsMenuDialog open onOpenChange={vi.fn()} />);

    expect(screen.queryByRole('button', { name: 'Email Verification' })).not.toBeInTheDocument();
  });

  it('keeps email verification settings available for cloud projects', () => {
    authSettingsMocks.isCloudProject = true;

    render(<AuthSettingsMenuDialog open onOpenChange={vi.fn()} />);

    expect(screen.getByRole('button', { name: 'Email Verification' })).toBeInTheDocument();
  });
});
