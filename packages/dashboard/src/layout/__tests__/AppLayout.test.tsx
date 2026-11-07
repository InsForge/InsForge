import { act, render, screen } from '@testing-library/react';
import { useEffect } from 'react';
import { MemoryRouter, useLocation } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { FEATURE_FLAG_VARIANTS } from '#lib/analytics/constants';

const mocks = vi.hoisted(() => {
  const flagListeners = new Set<() => void>();
  return {
    hostMode: 'cloud-hosting',
    ready: false,
    variant: undefined as string | undefined,
    flagListeners,
    // Stands in for PostHog calling onFeatureFlags subscribers when a flags response lands.
    setFlags(ready: boolean, variant?: string) {
      this.ready = ready;
      this.variant = variant;
      flagListeners.forEach((listener) => listener());
    },
  };
});

vi.mock('#lib/analytics/posthog', async () => {
  const { useEffect, useReducer } = await import('react');
  // Re-renders on a flags callback, like the real hooks.
  const useFlagsRerender = () => {
    const [, rerender] = useReducer((count: number) => count + 1, 0);
    useEffect(() => {
      mocks.flagListeners.add(rerender);
      return () => {
        mocks.flagListeners.delete(rerender);
      };
    }, []);
  };
  return {
    useFeatureFlagsReady: () => {
      useFlagsRerender();
      return mocks.ready;
    },
    useFeatureFlag: () => {
      useFlagsRerender();
      return mocks.variant;
    },
  };
});

vi.mock('#lib/config/DashboardHostContext', () => ({
  useDashboardHost: () => ({ mode: mocks.hostMode, showNavbar: false }),
}));

vi.mock('#lib/contexts/ThemeContext', () => ({
  ThemeProvider: ({ children }: { children: React.ReactNode }) => children,
}));

vi.mock('#lib/contexts/LocaleContext', () => ({
  LocaleProvider: ({ children }: { children: React.ReactNode }) => children,
}));

vi.mock('#features/dashboard/components/connect', () => ({
  ConnectDialog: ({ open }: { open: boolean }) =>
    open ? <div data-testid="connect-dialog" /> : null,
}));

vi.mock('#features/dashboard/components/dtest/DTestConnectTip', () => ({
  DTestConnectTip: () => null,
}));

vi.mock('#layout/AppSidebar', () => ({ default: () => null }));
vi.mock('#layout/AppHeader', () => ({ default: () => null }));

import AppLayout from '#layout/AppLayout';

// Every navigation gets a new location key, so this counts navigations, not distinct paths.
const visits: string[] = [];

function LocationRecorder() {
  const location = useLocation();
  useEffect(() => {
    visits.push(location.pathname);
  }, [location.key, location.pathname]);
  return null;
}

function renderLayout() {
  const tree = () => (
    <MemoryRouter initialEntries={['/dashboard']}>
      <AppLayout>
        <LocationRecorder />
      </AppLayout>
    </MemoryRouter>
  );
  const view = render(tree());
  return { ...view, rerenderLayout: () => view.rerender(tree()) };
}

// In jsdom a top-level window is its own parent, so a message from window counts as the parent's.
function postConnectMessage(type = 'SHOW_CONNECT_OVERLAY') {
  act(() => {
    window.dispatchEvent(new MessageEvent('message', { data: { type }, source: window }));
  });
}

const installVisits = () => visits.filter((path) => path === '/dashboard/install').length;

describe('ConnectOverlayBridge', () => {
  beforeEach(() => {
    mocks.hostMode = 'cloud-hosting';
    mocks.ready = false;
    mocks.variant = undefined;
    mocks.flagListeners.clear();
    visits.length = 0;
  });

  it('holds a connect message that arrives before flags are ready', () => {
    renderLayout();

    postConnectMessage();

    expect(screen.queryByTestId('connect-dialog')).toBeNull();
    expect(installVisits()).toBe(0);
  });

  it('replays a held message into the legacy dialog for a control user', () => {
    renderLayout();
    postConnectMessage('SHOW_ONBOARDING_OVERLAY');

    act(() => {
      mocks.setFlags(true, undefined);
    });

    expect(screen.getByTestId('connect-dialog')).toBeInTheDocument();
    expect(installVisits()).toBe(0);
  });

  it('replays a held message into the install page for a D_TEST user', () => {
    renderLayout();
    postConnectMessage();

    act(() => {
      mocks.setFlags(true, FEATURE_FLAG_VARIANTS.D_TEST);
    });

    expect(installVisits()).toBe(1);
    expect(screen.queryByTestId('connect-dialog')).toBeNull();
  });

  it('replays repeated held messages once', () => {
    const { rerenderLayout } = renderLayout();
    postConnectMessage();
    postConnectMessage('SHOW_ONBOARDING_OVERLAY');
    postConnectMessage();

    act(() => {
      mocks.setFlags(true, FEATURE_FLAG_VARIANTS.D_TEST);
    });
    rerenderLayout();

    expect(installVisits()).toBe(1);
  });

  it('drops a held message when the host leaves cloud mode before flags are ready', () => {
    const { rerenderLayout } = renderLayout();
    postConnectMessage();

    mocks.hostMode = 'self-hosting';
    rerenderLayout();
    act(() => {
      mocks.setFlags(true, FEATURE_FLAG_VARIANTS.D_TEST);
    });
    mocks.hostMode = 'cloud-hosting';
    rerenderLayout();

    expect(installVisits()).toBe(0);
    expect(screen.queryByTestId('connect-dialog')).toBeNull();
  });
});
