import { act, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => {
  const flagListeners = new Set<() => void>();
  return {
    entitlement: { isLoading: false, allowed: true, reason: null } as {
      isLoading: boolean;
      allowed: boolean;
      reason: 'plan' | 'partner' | null;
    },
    dashboardVariant: undefined as string | undefined,
    flagListeners,
    // Stands in for PostHog calling onFeatureFlags subscribers when a flags response lands.
    fireFlags() {
      flagListeners.forEach((listener) => listener());
    },
  };
});

vi.mock('#lib/hooks/useAiEntitlement', () => ({
  useAiEntitlement: () => mocks.entitlement,
}));

vi.mock('#lib/config/DashboardHostContext', () => ({
  useDashboardHost: () => ({ mode: 'cloud-hosting' }),
}));

vi.mock('#lib/utils/utils', async (importOriginal) => ({
  ...(await importOriginal<typeof import('#lib/utils/utils')>()),
  isInsForgeCloudProject: () => true,
}));

vi.mock('#lib/analytics/posthog', async () => {
  const { useEffect, useReducer } = await import('react');
  return {
    getFeatureFlag: () => undefined,
    // Re-renders on a flags callback, like the real hook, so a late variant has to arrive
    // through the listener rather than a manual rerender.
    useFeatureFlag: () => {
      const [, rerender] = useReducer((count: number) => count + 1, 0);
      useEffect(() => {
        mocks.flagListeners.add(rerender);
        return () => {
          mocks.flagListeners.delete(rerender);
        };
      }, []);
      return mocks.dashboardVariant;
    },
    useFeatureFlagsReady: () => true,
    useFeatureFlagsStatus: () => 'loaded',
  };
});

// Heavy children that pull in API/context of their own and are irrelevant here.
vi.mock('#features/dashboard/components', () => ({
  ProjectSettingsMenuDialog: () => null,
}));
vi.mock('#components', () => ({
  LanguageSelect: () => null,
}));

import AppSidebar from '#layout/AppSidebar';
import { FEATURE_FLAG_VARIANTS } from '#lib/analytics/constants';

function renderSidebar() {
  return render(
    <MemoryRouter>
      <AppSidebar isCollapsed={false} onToggleCollapse={() => {}} />
    </MemoryRouter>
  );
}

describe('AppSidebar AI tab', () => {
  beforeEach(() => {
    mocks.entitlement = { isLoading: false, allowed: true, reason: null };
    mocks.dashboardVariant = undefined;
  });

  it('shows the AI tab for an entitled project', () => {
    renderSidebar();
    expect(screen.getByText('Model Gateway')).toBeInTheDocument();
  });

  it('still shows it for a free org — they can upgrade from the page', () => {
    mocks.entitlement = { isLoading: false, allowed: false, reason: 'plan' };
    renderSidebar();
    expect(screen.getByText('Model Gateway')).toBeInTheDocument();
  });

  it('drops it for a partner org, which has no upgrade path', () => {
    mocks.entitlement = { isLoading: false, allowed: false, reason: 'partner' };
    renderSidebar();
    expect(screen.queryByText('Model Gateway')).not.toBeInTheDocument();
  });
});

describe('AppSidebar D_TEST items', () => {
  beforeEach(() => {
    mocks.entitlement = { isLoading: false, allowed: true, reason: null };
    mocks.dashboardVariant = undefined;
  });

  it('adds Install and Doc for a D_TEST user on cloud', () => {
    mocks.dashboardVariant = FEATURE_FLAG_VARIANTS.D_TEST;
    renderSidebar();

    expect(screen.getByText('Install')).toBeInTheDocument();
    expect(screen.getByText('Doc')).toBeInTheDocument();
  });

  it('leaves them out for the control variant', () => {
    mocks.dashboardVariant = 'control';
    renderSidebar();

    expect(screen.queryByText('Install')).not.toBeInTheDocument();
    expect(screen.queryByText('Doc')).not.toBeInTheDocument();
  });

  // The sidebar reads the flag through the hook now, so a variant landing after the first
  // render has to add the items. Reading it once left a D_TEST user without them.
  it('adds them when the variant arrives after the first render', () => {
    renderSidebar();
    expect(screen.queryByText('Install')).not.toBeInTheDocument();

    act(() => {
      mocks.dashboardVariant = FEATURE_FLAG_VARIANTS.D_TEST;
      mocks.fireFlags();
    });

    expect(screen.getByText('Install')).toBeInTheDocument();
  });
});
