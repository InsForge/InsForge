import type { ReactNode } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { renderHook, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { useAiEntitlement } from '#lib/hooks/useAiEntitlement';
import type { DashboardInstanceInfo } from '#types';

const hostState: {
  mode: string;
  onRequestInstanceInfo?: () => Promise<DashboardInstanceInfo | null>;
} = { mode: 'cloud-hosting' };

vi.mock('#lib/config/DashboardHostContext', () => ({
  useDashboardHost: () => hostState,
  useDashboardProject: () => ({ id: 'project-1' }),
  useIsCloudHostingMode: () => hostState.mode === 'cloud-hosting',
}));

function wrapper({ children }: { children: ReactNode }) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}

function instanceInfo(overrides: Partial<DashboardInstanceInfo>): DashboardInstanceInfo {
  return {
    currentInstanceType: 'nano',
    planName: 'pro',
    computeCredits: 0,
    currentOrgComputeCost: 0,
    instanceTypes: [],
    projects: [],
    ...overrides,
  } as DashboardInstanceInfo;
}

function setHost(info: Partial<DashboardInstanceInfo> | null, mode = 'cloud-hosting') {
  hostState.mode = mode;
  hostState.onRequestInstanceInfo =
    info === null ? undefined : () => Promise.resolve(instanceInfo(info));
}

describe('useAiEntitlement', () => {
  it('denies a free org with reason "plan"', async () => {
    setHost({ planName: 'free' });
    const { result } = renderHook(() => useAiEntitlement(), { wrapper });
    await waitFor(() => expect(result.current.allowed).toBe(false));
    expect(result.current.reason).toBe('plan');
  });

  it('denies a partner org with reason "partner"', async () => {
    setHost({ planName: 'team', isPartnerOrg: true });
    const { result } = renderHook(() => useAiEntitlement(), { wrapper });
    await waitFor(() => expect(result.current.allowed).toBe(false));
    expect(result.current.reason).toBe('partner');
  });

  it('denies a partner org even on the free plan, reporting partner first', async () => {
    setHost({ planName: 'free', isPartnerOrg: true });
    const { result } = renderHook(() => useAiEntitlement(), { wrapper });
    await waitFor(() => expect(result.current.allowed).toBe(false));
    expect(result.current.reason).toBe('partner');
  });

  it('allows a paid non-partner org', async () => {
    setHost({ planName: 'pro' });
    const { result } = renderHook(() => useAiEntitlement(), { wrapper });
    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(result.current.allowed).toBe(true);
    expect(result.current.reason).toBeNull();
  });

  it('allows self-hosting outright — it brings its own key', async () => {
    setHost(null, 'self-hosting');
    const { result } = renderHook(() => useAiEntitlement(), { wrapper });
    expect(result.current.allowed).toBe(true);
    expect(result.current.isLoading).toBe(false);
  });

  it('fails open while the bridge is still resolving', () => {
    hostState.mode = 'cloud-hosting';
    hostState.onRequestInstanceInfo = () => new Promise(() => {});
    const { result } = renderHook(() => useAiEntitlement(), { wrapper });
    // No upgrade wall flashed at a paying customer mid-load.
    expect(result.current.allowed).toBe(true);
  });

  it('fails open when the bridge rejects', async () => {
    hostState.mode = 'cloud-hosting';
    hostState.onRequestInstanceInfo = () => Promise.reject(new Error('bridge down'));
    const { result } = renderHook(() => useAiEntitlement(), { wrapper });
    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(result.current.allowed).toBe(true);
  });
});
