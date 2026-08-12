import { describe, it, expect, beforeEach, vi } from 'vitest';
import type { ReactNode } from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

// The router pulls in every feature layout in the app. Only the three this file
// asserts on need real identities; the rest are reached through their own
// modules and are left alone. RequireAuth and AppLayout are stubbed because
// they need auth state and a full chrome that has nothing to do with routing.
vi.mock('#router/RequireAuth', () => ({
  RequireAuth: ({ children }: { children: ReactNode }) => <>{children}</>,
}));
vi.mock('#layout/AppLayout', async () => {
  const { useState } = await import('react');
  const { Link } = await import('react-router-dom');

  return {
    default: ({ children }: { children: ReactNode }) => {
      const [layoutState, setLayoutState] = useState(0);

      return (
        <>
          <button onClick={() => setLayoutState((value) => value + 1)}>
            LAYOUT_STATE_{layoutState}
          </button>
          <Link to="/dashboard/analytics/traffic">GO_TO_ANALYTICS</Link>
          {children}
        </>
      );
    },
  };
});
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

  // Regression: the sidebar shows "Web Scraper" in both modes (AppSidebar
  // pushes dashboardWebscraperMenuItem unconditionally), but the route subtree
  // used to be wrapped in `{isCloudHosting && ...}`. On a self-hosted install
  // the nav entry therefore matched no route, fell through to the catch-all
  // `<Route path="*">` and silently bounced back to /dashboard — making the
  // whole self-hosted Web Scraper feature unreachable.
  // Lazy routes resolve through Suspense, so assert with async findByText.
  it('serves the webscraper route in self-hosting', async () => {
    renderAt('/dashboard/webscraper/actors');

    expect(await screen.findByText('WEBSCRAPER_LAYOUT')).toBeInTheDocument();
  });

  it('still serves the webscraper route in cloud-hosting', async () => {
    host.mode = 'cloud-hosting';
    renderAt('/dashboard/webscraper/actors');

    expect(await screen.findByText('WEBSCRAPER_LAYOUT')).toBeInTheDocument();
  });

  // Analytics used to be cloud-only and this asserted that. Self-hosting now
  // connects with the admin's own PostHog personal API key, so the sidebar
  // pushes the entry in both modes and the route has to match in both — the
  // same trap the webscraper cases above cover.
  it('serves the analytics route in self-hosting', async () => {
    renderAt('/dashboard/analytics/traffic');

    expect(await screen.findByText('ANALYTICS_LAYOUT')).toBeInTheDocument();
    // Falling through to the catch-all is the failure mode being guarded here,
    // and it renders the dashboard home rather than erroring.
    expect(screen.queryByText('DASHBOARD_HOME')).toBeNull();
  });

  it('still serves analytics in cloud-hosting', async () => {
    host.mode = 'cloud-hosting';
    renderAt('/dashboard/analytics/traffic');

    expect(await screen.findByText('ANALYTICS_LAYOUT')).toBeInTheDocument();
  });

  it('preserves AppLayout state while navigating between authenticated routes', async () => {
    renderAt('/dashboard/webscraper/actors');
    expect(await screen.findByText('WEBSCRAPER_LAYOUT')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'LAYOUT_STATE_0' }));
    expect(screen.getByRole('button', { name: 'LAYOUT_STATE_1' })).toBeInTheDocument();

    fireEvent.click(screen.getByRole('link', { name: 'GO_TO_ANALYTICS' }));
    expect(await screen.findByText('ANALYTICS_LAYOUT')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'LAYOUT_STATE_1' })).toBeInTheDocument();
  });
});
