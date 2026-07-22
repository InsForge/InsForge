import { render, screen, waitFor } from '@testing-library/react';
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
  smtpIsLoading: false,
  smtpError: null as Error | null,
  smtpQueryEnabled: undefined as boolean | undefined,
  refetchSmtpConfig: vi.fn(),
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
  useSmtpConfig: ({ enabled }: { enabled?: boolean } = {}) => {
    authSettingsMocks.smtpQueryEnabled = enabled;
    return {
      config:
        authSettingsMocks.smtpIsLoading || authSettingsMocks.smtpError
          ? undefined
          : { enabled: authSettingsMocks.smtpEnabled },
      isLoading: authSettingsMocks.smtpIsLoading,
      error: authSettingsMocks.smtpError,
      refetch: authSettingsMocks.refetchSmtpConfig,
    };
  },
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
    authSettingsMocks.smtpIsLoading = false;
    authSettingsMocks.smtpError = null;
    authSettingsMocks.smtpQueryEnabled = undefined;
    authSettingsMocks.authConfig.requireEmailVerification = false;
    authSettingsMocks.refetchSmtpConfig.mockReset();
    authSettingsMocks.showToast.mockReset();
    authSettingsMocks.updateConfig.mockReset();
  });

  it('shows email verification settings for self-hosted projects with SMTP enabled', async () => {
    const user = userEvent.setup();
    authSettingsMocks.smtpEnabled = true;

    render(<AuthSettingsMenuDialog open onOpenChange={vi.fn()} />);

    expect(authSettingsMocks.smtpQueryEnabled).toBe(true);

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
    expect(authSettingsMocks.smtpQueryEnabled).toBe(false);
  });

  it('does not query SMTP while the settings dialog is closed', () => {
    render(<AuthSettingsMenuDialog open={false} onOpenChange={vi.fn()} />);

    expect(authSettingsMocks.smtpQueryEnabled).toBe(false);
  });

  it('keeps email verification accessible while SMTP availability is loading', async () => {
    const user = userEvent.setup();
    authSettingsMocks.smtpIsLoading = true;

    render(<AuthSettingsMenuDialog open onOpenChange={vi.fn()} />);

    await user.click(screen.getByRole('button', { name: 'Email Verification' }));

    expect(screen.getByText('Loading email provider configuration...')).toBeInTheDocument();
    expect(screen.queryByRole('switch')).not.toBeInTheDocument();
  });

  it('shows a retryable SMTP lookup error without reporting a missing provider', async () => {
    const user = userEvent.setup();
    authSettingsMocks.authConfig.requireEmailVerification = true;
    authSettingsMocks.smtpError = new Error('Request failed');

    render(<AuthSettingsMenuDialog open onOpenChange={vi.fn()} />);

    await user.click(screen.getByRole('button', { name: 'Email Verification' }));

    expect(
      screen.getByText('Could not check email provider availability. Try again to continue.')
    ).toBeInTheDocument();
    expect(
      screen.queryByText(
        'No email provider is available. Turn off required email verification before saving, or enable custom SMTP.'
      )
    ).not.toBeInTheDocument();
    expect(screen.queryByRole('switch')).not.toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Retry' }));

    expect(authSettingsMocks.refetchSmtpConfig).toHaveBeenCalledTimes(1);
  });

  it('allows recovering an existing required-verification state without a provider', async () => {
    const user = userEvent.setup();
    authSettingsMocks.authConfig.requireEmailVerification = true;

    render(<AuthSettingsMenuDialog open onOpenChange={vi.fn()} />);

    await user.click(screen.getByRole('button', { name: 'Email Verification' }));

    expect(
      screen.getByText(
        'No email provider is available. Turn off required email verification before saving, or enable custom SMTP.'
      )
    ).toBeInTheDocument();

    const verificationSwitch = screen.getByRole('switch');
    expect(verificationSwitch).toBeChecked();
    await user.click(verificationSwitch);
    expect(verificationSwitch).not.toBeChecked();
    expect(verificationSwitch).toBeDisabled();

    await user.click(screen.getByRole('button', { name: 'Save Changes' }));

    await waitFor(() =>
      expect(authSettingsMocks.updateConfig).toHaveBeenCalledWith(
        expect.objectContaining({ requireEmailVerification: false })
      )
    );
  });
});
