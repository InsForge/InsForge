import { render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { FEATURE_FLAG_VARIANTS } from '#lib/analytics/constants';

const flags = vi.hoisted(() => ({
  ready: false,
  variant: undefined as string | undefined,
}));

vi.mock('#lib/analytics/posthog', () => ({
  useFeatureFlagsReady: () => flags.ready,
  useFeatureFlag: () => flags.variant,
}));

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

const loginRoutes = () => (
  <MemoryRouter initialEntries={['/cloud/login']}>
    <Routes>
      <Route path="/cloud/login" element={<CloudLoginPage />} />
      <Route path="/dashboard" element={<div>DASHBOARD_HOME</div>} />
      <Route path="/dashboard/install" element={<div>DTEST_INSTALL</div>} />
    </Routes>
  </MemoryRouter>
);

describe('CloudLoginPage redirect', () => {
  beforeEach(() => {
    flags.ready = false;
    flags.variant = undefined;
  });

  // The redirect only runs once, so going before the variant is known would send a
  // D_TEST user to the regular dashboard for good.
  it('waits for feature flags, then sends a new D_TEST user to the install page', () => {
    const view = render(loginRoutes());

    expect(screen.queryByText('DASHBOARD_HOME')).toBeNull();
    expect(screen.queryByText('DTEST_INSTALL')).toBeNull();

    flags.ready = true;
    flags.variant = FEATURE_FLAG_VARIANTS.D_TEST;
    view.rerender(loginRoutes());

    expect(screen.getByText('DTEST_INSTALL')).toBeInTheDocument();
  });

  it('sends everyone else to the dashboard once flags are ready', () => {
    flags.ready = true;
    render(loginRoutes());

    expect(screen.getByText('DASHBOARD_HOME')).toBeInTheDocument();
  });
});
