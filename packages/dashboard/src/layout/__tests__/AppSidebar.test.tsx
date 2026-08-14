import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  entitlement: { isLoading: false, allowed: true, reason: null } as {
    isLoading: boolean;
    allowed: boolean;
    reason: 'plan' | 'partner' | null;
  },
}));

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

vi.mock('#lib/analytics/posthog', () => ({
  getFeatureFlag: () => undefined,
}));

// Heavy children that pull in API/context of their own and are irrelevant here.
vi.mock('#features/dashboard/components', () => ({
  ProjectSettingsMenuDialog: () => null,
}));
vi.mock('#components', () => ({
  LanguageSelect: () => null,
}));

import AppSidebar from '#layout/AppSidebar';

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
