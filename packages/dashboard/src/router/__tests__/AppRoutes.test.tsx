import { describe, it, expect, beforeEach, vi } from 'vitest';
import type { ReactNode } from 'react';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

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
vi.mock('#features/dashboard/components/DashboardLayout', () => ({
  default: () => <div>DASHBOARD_HOME</div>,
}));

const host = { mode: 'self-hosting' as 'self-hosting' | 'cloud-hosting' };
vi.mock('#lib/config/DashboardHostContext', async (importOriginal) => {
  const actual = await importOriginal<typeof import('#lib/config/DashboardHostContext')>();
  return { ...actual, useIsCloudHostingMode: () => host.mode === 'cloud-hosting' };
});

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

  // The sidebar shows "Web Scraper" in both modes (AppSidebar pushes
  // dashboardWebscraperMenuItem unconditionally), so the route must match in
  // both: otherwise the nav entry falls through to the catch-all
  // `<Route path="*">` and silently bounces back to /dashboard.
  it('serves the webscraper route in self-hosting', () => {
    renderAt('/dashboard/webscraper/actors');

    expect(screen.getByText('WEBSCRAPER_LAYOUT')).toBeInTheDocument();
  });

  it('still serves the webscraper route in cloud-hosting', () => {
    host.mode = 'cloud-hosting';
    renderAt('/dashboard/webscraper/actors');

    expect(screen.getByText('WEBSCRAPER_LAYOUT')).toBeInTheDocument();
  });

  // Self-hosting connects with the admin's own PostHog personal API key, so the
  // sidebar pushes the Analytics entry in both modes and the route has to match
  // in both — the same trap the webscraper cases above cover.
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
