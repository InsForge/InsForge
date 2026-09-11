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

let currentProjectId = 'project-1';

vi.mock('#lib/config/DashboardHostContext', () => ({
  useDashboardHost: () => hostState,
  useDashboardProject: () => ({ id: currentProjectId }),
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
  currentProjectId = 'project-1';
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

  it('gives up after one attempt so a hung bridge cannot stack retries', async () => {
    // The bridge already self-terminates at 15s; react-query's default 3
    // retries would turn that into ~a minute of spinner on the gate.
    const attempt = vi.fn().mockRejectedValue(new Error('bridge down'));
    hostState.mode = 'cloud-hosting';
    hostState.onRequestInstanceInfo = attempt;

    const { result } = renderHook(() => useAiEntitlement(), { wrapper });

    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(attempt).toHaveBeenCalledTimes(1);
    expect(result.current.allowed).toBe(true);
  });

  it('re-resolves when the project changes under a shared QueryClient', async () => {
    // The regression the project-scoped query key guards: without it the first
    // org's verdict stays fresh for the whole staleTime and is served to the
    // second.
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const shared = ({ children }: { children: ReactNode }) => (
      <QueryClientProvider client={client}>{children}</QueryClientProvider>
    );

    const byProject: Record<string, Partial<DashboardInstanceInfo>> = {
      'project-free': { planName: 'free' },
      'project-paid': { planName: 'pro' },
    };
    hostState.mode = 'cloud-hosting';
    hostState.onRequestInstanceInfo = () =>
      Promise.resolve(instanceInfo(byProject[currentProjectId]));

    currentProjectId = 'project-free';
    const first = renderHook(() => useAiEntitlement(), { wrapper: shared });
    await waitFor(() => expect(first.result.current.allowed).toBe(false));
    expect(first.result.current.reason).toBe('plan');
    first.unmount();

    currentProjectId = 'project-paid';
    const second = renderHook(() => useAiEntitlement(), { wrapper: shared });
    await waitFor(() => expect(second.result.current.isLoading).toBe(false));
    expect(second.result.current.allowed).toBe(true);
  });
});
