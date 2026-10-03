import { describe, it, expect, beforeEach, vi } from 'vitest';
import type { ReactNode } from 'react';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { FEATURE_FLAG_VARIANTS } from '#lib/analytics/constants';

// The router pulls in every feature layout in the app. Only the three this file
// asserts on need real identities; the rest are reached through their own
// modules and are left alone. RequireAuth and AppLayout are stubbed because
// they need auth state and a full chrome that has nothing to do with routing.
vi.mock('#router/RequireAuth', () => ({
  RequireAuth: ({ children }: { children: ReactNode }) => <>{children}</>,
}));
vi.mock('#layout/AppLayout', () => ({
  default: ({ children }: { children: ReactNode }) => <>{children}</>,
}));
vi.mock('#features/webscraper/components/WebscraperLayout', () => ({
  default: () => <div>WEBSCRAPER_LAYOUT</div>,
}));
vi.mock('#features/analytics/components/AnalyticsLayout', () => ({
  default: () => <div>ANALYTICS_LAYOUT</div>,
}));
vi.mock('#features/dashboard/components/DashboardLayout', async () => {
  const { Outlet } = await import('react-router-dom');
  return {
    default: () => (
      <>
        <div>DASHBOARD_HOME</div>
        <Outlet />
      </>
    ),
  };
});
vi.mock('#features/dashboard/pages/DashboardPage', () => ({
  default: () => <div>LEGACY_HOME</div>,
}));
vi.mock('#features/dashboard/pages/DTestDashboardPage', () => ({
  default: () => <div>DTEST_HOME</div>,
}));
vi.mock('#features/dashboard/pages/DTestInstallPage', () => ({
  default: () => <div>DTEST_INSTALL</div>,
}));

const host = { mode: 'self-hosting' as 'self-hosting' | 'cloud-hosting' };
vi.mock('#lib/config/DashboardHostContext', async (importOriginal) => {
  const actual = await importOriginal<typeof import('#lib/config/DashboardHostContext')>();
  return { ...actual, useIsCloudHostingMode: () => host.mode === 'cloud-hosting' };
});

const flags = {
  status: 'loaded' as 'pending' | 'loaded' | 'unavailable',
  variant: undefined as string | undefined,
};
vi.mock('#lib/analytics/posthog', async (importOriginal) => ({
  ...(await importOriginal<typeof import('#lib/analytics/posthog')>()),
  useFeatureFlagsStatus: () => flags.status,
  useFeatureFlagsReady: () => flags.status !== 'pending',
  useFeatureFlag: () => flags.variant,
}));

const { AppRoutes } = await import('#router/AppRoutes');

function renderAt(path: string) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <AppRoutes />
    </MemoryRouter>
  );
}

describe('AppRoutes host-mode gating', () => {
  beforeEach(() => {
    host.mode = 'self-hosting';
  });

  // Regression: the sidebar shows "Web Scraper" in both modes (AppSidebar
  // pushes dashboardWebscraperMenuItem unconditionally), but the route subtree
  // used to be wrapped in `{isCloudHosting && ...}`. On a self-hosted install
  // the nav entry therefore matched no route, fell through to the catch-all
  // `<Route path="*">` and silently bounced back to /dashboard — making the
  // whole self-hosted Web Scraper feature unreachable.
  it('serves the webscraper route in self-hosting', () => {
    renderAt('/dashboard/webscraper/actors');

    expect(screen.getByText('WEBSCRAPER_LAYOUT')).toBeInTheDocument();
  });

  it('still serves the webscraper route in cloud-hosting', () => {
    host.mode = 'cloud-hosting';
    renderAt('/dashboard/webscraper/actors');

    expect(screen.getByText('WEBSCRAPER_LAYOUT')).toBeInTheDocument();
  });

  // Analytics used to be cloud-only and this asserted that. Self-hosting now
  // connects with the admin's own PostHog personal API key, so the sidebar
  // pushes the entry in both modes and the route has to match in both — the
  // same trap the webscraper cases above cover.
  it('serves the analytics route in self-hosting', () => {
    renderAt('/dashboard/analytics/traffic');

    expect(screen.getByText('ANALYTICS_LAYOUT')).toBeInTheDocument();
    // Falling through to the catch-all is the failure mode being guarded here,
    // and it renders the dashboard home rather than erroring.
    expect(screen.queryByText('DASHBOARD_HOME')).toBeNull();
  });

  it('still serves analytics in cloud-hosting', () => {
    host.mode = 'cloud-hosting';
    renderAt('/dashboard/analytics/traffic');

    expect(screen.getByText('ANALYTICS_LAYOUT')).toBeInTheDocument();
  });
});

describe('AppRoutes /dashboard/install', () => {
  beforeEach(() => {
    flags.status = 'pending';
    flags.variant = undefined;
  });

  function rerenderAtInstall(view: ReturnType<typeof renderAt>) {
    view.rerender(
      <MemoryRouter initialEntries={['/dashboard/install']}>
        <AppRoutes />
      </MemoryRouter>
    );
  }

  // Redirecting while flags are still loading would send D_TEST users away from
  // the install page on every hard refresh.
  it('waits for feature flags before deciding, then shows the D_TEST install page', () => {
    const view = renderAt('/dashboard/install');

    expect(screen.queryByText('DTEST_INSTALL')).toBeNull();
    expect(screen.queryByText('LEGACY_HOME')).toBeNull();

    flags.status = 'loaded';
    flags.variant = FEATURE_FLAG_VARIANTS.D_TEST;
    rerenderAtInstall(view);

    expect(screen.getByText('DTEST_INSTALL')).toBeInTheDocument();
  });

  it('redirects to the dashboard home once flags load without the D_TEST variant', () => {
    flags.status = 'loaded';
    renderAt('/dashboard/install');

    expect(screen.getByText('LEGACY_HOME')).toBeInTheDocument();
    expect(screen.queryByText('DTEST_INSTALL')).toBeNull();
  });

  // The whole point of separating `unavailable` from `loaded`. Giving up on the flags request
  // leaves every variant undefined, which reads exactly like a control user. Redirecting on
  // that guess is a navigation, and the D_TEST answer arriving a second later cannot undo it.
  it('keeps the install page when the flags request gave no answer', () => {
    flags.status = 'unavailable';
    renderAt('/dashboard/install');

    expect(screen.getByText('DTEST_INSTALL')).toBeInTheDocument();
    expect(screen.queryByText('LEGACY_HOME')).toBeNull();
  });

  it('redirects once a late answer confirms the user is not in D_TEST', () => {
    flags.status = 'unavailable';
    const view = renderAt('/dashboard/install');
    expect(screen.getByText('DTEST_INSTALL')).toBeInTheDocument();

    flags.status = 'loaded';
    rerenderAtInstall(view);

    expect(screen.getByText('LEGACY_HOME')).toBeInTheDocument();
    expect(screen.queryByText('DTEST_INSTALL')).toBeNull();
  });
});
