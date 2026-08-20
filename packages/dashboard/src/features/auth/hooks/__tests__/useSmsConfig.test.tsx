import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, renderHook, waitFor } from '@testing-library/react';
import type { PropsWithChildren } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { SmsConfigSchema, UpsertSmsConfigRequest } from '@insforge/shared-schemas';
import '#lib/i18n';
import { useSmsConfig } from '#features/auth/hooks/useSmsConfig';

const smsMocks = vi.hoisted(() => ({
  getConfig: vi.fn(),
  updateConfig: vi.fn(),
  showToast: vi.fn(),
}));

vi.mock('#features/auth/services/sms-config.service', () => ({
  smsConfigService: {
    getConfig: smsMocks.getConfig,
    updateConfig: smsMocks.updateConfig,
  },
}));

vi.mock('@insforge/ui', () => ({
  useToast: () => ({ showToast: smsMocks.showToast }),
}));

const ENABLED_CONFIG: SmsConfigSchema = {
  id: '11111111-1111-4111-8111-111111111111',
  enabled: true,
  provider: 'twilio',
  accountSid: 'ACtest',
  hasAuthToken: true,
  fromNumber: '+15550001111',
  messagingServiceSid: '',
  minIntervalSeconds: 60,
  otpMessageTemplate: 'Your verification code is {{ code }}. It expires in 5 minutes.',
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
};

const DISABLED_CONFIG: SmsConfigSchema = {
  ...ENABLED_CONFIG,
  enabled: false,
  updatedAt: '2026-01-02T00:00:00.000Z',
};

const DISABLED_INPUT: UpsertSmsConfigRequest = {
  enabled: false,
  provider: 'twilio',
  accountSid: 'ACtest',
  fromNumber: '+15550001111',
  messagingServiceSid: '',
  minIntervalSeconds: 60,
  otpMessageTemplate: 'Your verification code is {{ code }}. It expires in 5 minutes.',
};

function createWrapper(queryClient: QueryClient) {
  return function Wrapper({ children }: PropsWithChildren) {
    return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>;
  };
}

describe('useSmsConfig', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    smsMocks.getConfig.mockResolvedValue(ENABLED_CONFIG);
    smsMocks.updateConfig.mockResolvedValue(DISABLED_CONFIG);
  });

  it('does not fetch SMS configuration when disabled', () => {
    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });

    const { result } = renderHook(() => useSmsConfig({ enabled: false }), {
      wrapper: createWrapper(queryClient),
    });

    expect(result.current.isLoading).toBe(false);
    expect(smsMocks.getConfig).not.toHaveBeenCalled();
  });

  it('updates the SMS cache immediately from the mutation response', async () => {
    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
    const { result } = renderHook(() => useSmsConfig(), {
      wrapper: createWrapper(queryClient),
    });

    await waitFor(() => expect(result.current.config).toEqual(ENABLED_CONFIG));

    act(() => {
      result.current.updateConfig(DISABLED_INPUT);
    });

    await waitFor(() => expect(queryClient.getQueryData(['sms-config'])).toEqual(DISABLED_CONFIG));
    expect(smsMocks.getConfig).toHaveBeenCalledTimes(1);
  });
});
