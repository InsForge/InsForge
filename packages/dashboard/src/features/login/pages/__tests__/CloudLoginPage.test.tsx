import { act, render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { FEATURE_FLAG_VARIANTS } from '#lib/analytics/constants';

const flags = vi.hoisted(() => {
  const state = {
    ready: false,
    variant: undefined as string | undefined,
    listeners: new Set<() => void>(),
    // Stands in for PostHog calling onFeatureFlags subscribers when a flags response lands.
    fire(variant: string) {
      state.ready = true;
      state.variant = variant;
      state.listeners.forEach((listener) => listener());
    },
  };
  return state;
});

vi.mock('#lib/analytics/posthog', async () => {
  const { useEffect, useReducer } = await import('react');
  // Re-renders on a flags callback, like the real hooks, so the variant has to reach the
  // page through the listener rather than a manual rerender.
  const useFlagsSubscription = () => {
    const [, rerender] = useReducer((count: number) => count + 1, 0);
    useEffect(() => {
      flags.listeners.add(rerender);
      return () => {
        flags.listeners.delete(rerender);
      };
    }, []);
  };
  return {
    useFeatureFlagsReady: () => {
      useFlagsSubscription();
      return flags.ready;
    },
    useFeatureFlag: () => {
      useFlagsSubscription();
      return flags.variant;
    },
  };
});

vi.mock('#lib/contexts/AuthContext', () => ({
  useAuth: () => ({ isAuthenticated: true, isLoading: false, error: null, refreshAuth: vi.fn() }),
}));

vi.mock('#features/logs/hooks/useMcpUsage', () => ({
  useMcpUsage: () => ({ hasCompletedOnboarding: false, isLoading: false }),
}));

vi.mock('#lib/config/DashboardHostContext', () => ({
  useDashboardHost: () => ({ mode: 'cloud-hosting' }),
  useDashboardProject: () => ({ id: 'project-1', isBranch: false }),
}));

import CloudLoginPage from '#features/login/pages/CloudLoginPage';

function renderLogin() {
  return render(
    <MemoryRouter initialEntries={['/cloud/login']}>
      <Routes>
        <Route path="/cloud/login" element={<CloudLoginPage />} />
        <Route path="/dashboard" element={<div>DASHBOARD_HOME</div>} />
        <Route path="/dashboard/install" element={<div>DTEST_INSTALL</div>} />
      </Routes>
    </MemoryRouter>
  );
}

function expectStillOnLogin() {
  expect(screen.getByText('Preparing dashboard...')).toBeInTheDocument();
  expect(screen.queryByText('DASHBOARD_HOME')).toBeNull();
  expect(screen.queryByText('DTEST_INSTALL')).toBeNull();
}

describe('CloudLoginPage redirect', () => {
  beforeEach(() => {
    flags.ready = false;
    flags.variant = undefined;
    flags.listeners.clear();
  });

  // The redirect only runs once, so going before the variant is known would send a
  // D_TEST user to the regular dashboard for good.
  it('waits for feature flags, then sends a new D_TEST user to the install page', () => {
    renderLogin();
    expectStillOnLogin();

    act(() => {
      flags.fire(FEATURE_FLAG_VARIANTS.D_TEST);
    });

    expect(screen.getByText('DTEST_INSTALL')).toBeInTheDocument();
    expect(screen.queryByText('DASHBOARD_HOME')).toBeNull();
  });

  it('waits for feature flags, then sends a control user to the dashboard', () => {
    renderLogin();
    expectStillOnLogin();

    act(() => {
      flags.fire('control');
    });

    expect(screen.getByText('DASHBOARD_HOME')).toBeInTheDocument();
    expect(screen.queryByText('DTEST_INSTALL')).toBeNull();
  });
});
