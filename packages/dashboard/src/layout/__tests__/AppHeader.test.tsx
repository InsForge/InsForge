import { act, fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { FEATURE_FLAG_VARIANTS } from '#lib/analytics/constants';

const mocks = vi.hoisted(() => {
  const state = {
    ready: false,
    variant: undefined as string | undefined,
    listeners: new Set<() => void>(),
    openConnectDialog: vi.fn(),
    // Stands in for PostHog calling onFeatureFlags subscribers when a flags response lands.
    fireFlags(variant: string) {
      state.ready = true;
      state.variant = variant;
      state.listeners.forEach((listener) => listener());
    },
  };
  return state;
});

vi.mock('#lib/analytics/posthog', async () => {
  const { useEffect, useReducer } = await import('react');
  // Re-renders on a flags callback, like the real hooks, so readiness has to reach the
  // header through the listener rather than a manual rerender.
  const useFlagsSubscription = () => {
    const [, rerender] = useReducer((count: number) => count + 1, 0);
    useEffect(() => {
      mocks.listeners.add(rerender);
      return () => {
        mocks.listeners.delete(rerender);
      };
    }, []);
  };
  return {
    useFeatureFlagsReady: () => {
      useFlagsSubscription();
      return mocks.ready;
    },
    useFeatureFlag: () => {
      useFlagsSubscription();
      return mocks.variant;
    },
  };
});

vi.mock('#lib/contexts/ThemeContext', () => ({
  useTheme: () => ({ resolvedTheme: 'dark' }),
}));

vi.mock('#lib/contexts/AuthContext', () => ({
  useAuth: () => ({ logout: vi.fn() }),
}));

vi.mock('#layout/ConnectDialogContext', () => ({
  useOpenConnectDialog: () => mocks.openConnectDialog,
}));

vi.mock('#features/dashboard/services/github.service', () => ({
  githubService: { getRepositoryMetadata: () => new Promise(() => {}) },
}));

vi.mock('#components', () => ({
  Avatar: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  AvatarFallback: ({ children }: { children: React.ReactNode }) => <span>{children}</span>,
  LanguageSelect: () => null,
  Separator: () => null,
  ThemeSelect: () => null,
}));

vi.mock('#assets/logos/discord.svg?react', () => ({ default: () => null }));
vi.mock('#assets/logos/github.svg?react', () => ({ default: () => null }));
vi.mock('#assets/logos/insforge_light.svg', () => ({ default: 'insforge_light.svg' }));
vi.mock('#assets/logos/insforge_dark.svg', () => ({ default: 'insforge_dark.svg' }));

import AppHeader from '#layout/AppHeader';

function renderHeaderAt(path: string) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <AppHeader />
      <Routes>
        <Route path="/dashboard" element={<div>DASHBOARD_HOME</div>} />
        <Route path="/dashboard/install" element={<div>DTEST_INSTALL</div>} />
      </Routes>
    </MemoryRouter>
  );
}

const connectButton = () => screen.getByRole('button', { name: /connect/i });

describe('AppHeader Connect button', () => {
  beforeEach(() => {
    mocks.ready = false;
    mocks.variant = undefined;
    mocks.listeners.clear();
    mocks.openConnectDialog.mockReset();
  });

  // Before the variant is known, a click would open the legacy dialog even for D_TEST users.
  it('stays disabled while flags load, then opens the connect dialog for a control user', () => {
    renderHeaderAt('/dashboard');

    expect(connectButton()).toBeDisabled();
    fireEvent.click(connectButton());
    expect(mocks.openConnectDialog).not.toHaveBeenCalled();

    act(() => {
      mocks.fireFlags('control');
    });

    expect(connectButton()).toBeEnabled();
    fireEvent.click(connectButton());
    expect(mocks.openConnectDialog).toHaveBeenCalledTimes(1);
  });

  it('enables for a D_TEST user once flags load and sends them to the install page', () => {
    renderHeaderAt('/dashboard');
    expect(connectButton()).toBeDisabled();

    act(() => {
      mocks.fireFlags(FEATURE_FLAG_VARIANTS.D_TEST);
    });

    expect(connectButton()).toBeEnabled();
    fireEvent.click(connectButton());
    expect(screen.getByText('DTEST_INSTALL')).toBeInTheDocument();
    expect(mocks.openConnectDialog).not.toHaveBeenCalled();
  });

  it('stays disabled for a D_TEST user who is already on the install page', () => {
    renderHeaderAt('/dashboard/install');
    expect(connectButton()).toBeDisabled();

    act(() => {
      mocks.fireFlags(FEATURE_FLAG_VARIANTS.D_TEST);
    });

    expect(connectButton()).toBeDisabled();
  });
});
