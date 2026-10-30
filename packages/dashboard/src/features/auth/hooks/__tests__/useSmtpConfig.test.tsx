import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, renderHook, waitFor } from '@testing-library/react';
import type { PropsWithChildren } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { SmtpConfigSchema, UpsertSmtpConfigRequest } from '@insforge/shared-schemas';
import '#lib/i18n';
import { useSmtpConfig } from '#features/auth/hooks/useSmtpConfig';

const smtpMocks = vi.hoisted(() => ({
  getConfig: vi.fn(),
  updateConfig: vi.fn(),
  showToast: vi.fn(),
}));

vi.mock('#features/auth/services/smtp-config.service', () => ({
  smtpConfigService: {
    getConfig: smtpMocks.getConfig,
    updateConfig: smtpMocks.updateConfig,
  },
}));

vi.mock('@insforge/ui', () => ({
  useToast: () => ({ showToast: smtpMocks.showToast }),
}));

const ENABLED_CONFIG: SmtpConfigSchema = {
  id: '11111111-1111-4111-8111-111111111111',
  enabled: true,
  host: 'smtp.example.com',
  port: 465,
  username: 'mailer',
  hasPassword: true,
  senderEmail: 'mailer@example.com',
  senderName: 'Mailer',
  minIntervalSeconds: 60,
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
};

const DISABLED_CONFIG: SmtpConfigSchema = {
  ...ENABLED_CONFIG,
  enabled: false,
  updatedAt: '2026-01-02T00:00:00.000Z',
};

const DISABLED_INPUT: UpsertSmtpConfigRequest = {
  enabled: false,
  host: 'smtp.example.com',
  port: 465,
  username: 'mailer',
  senderEmail: 'mailer@example.com',
  senderName: 'Mailer',
  minIntervalSeconds: 60,
};

function createWrapper(queryClient: QueryClient) {
  return function Wrapper({ children }: PropsWithChildren) {
    return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>;
  };
}

describe('useSmtpConfig', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    smtpMocks.getConfig.mockResolvedValue(ENABLED_CONFIG);
    smtpMocks.updateConfig.mockResolvedValue(DISABLED_CONFIG);
  });

  it('does not fetch SMTP configuration when disabled', () => {
    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });

    const { result } = renderHook(() => useSmtpConfig({ enabled: false }), {
      wrapper: createWrapper(queryClient),
    });

    expect(result.current.isLoading).toBe(false);
    expect(smtpMocks.getConfig).not.toHaveBeenCalled();
  });

  it('updates the SMTP cache immediately from the mutation response', async () => {
    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
    const { result } = renderHook(() => useSmtpConfig(), {
      wrapper: createWrapper(queryClient),
    });

    await waitFor(() => expect(result.current.config).toEqual(ENABLED_CONFIG));

    act(() => {
      result.current.updateConfig(DISABLED_INPUT);
    });

    await waitFor(() => expect(queryClient.getQueryData(['smtp-config'])).toEqual(DISABLED_CONFIG));
    expect(smtpMocks.getConfig).toHaveBeenCalledTimes(1);
  });
});
