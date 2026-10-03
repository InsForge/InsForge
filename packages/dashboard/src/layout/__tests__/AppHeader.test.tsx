import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
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

vi.mock('#lib/contexts/ThemeContext', () => ({
  useTheme: () => ({ resolvedTheme: 'dark' }),
}));

vi.mock('#lib/contexts/AuthContext', () => ({
  useAuth: () => ({ logout: vi.fn() }),
}));

vi.mock('#layout/ConnectDialogContext', () => ({
  useOpenConnectDialog: () => vi.fn(),
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
    </MemoryRouter>
  );
}

const connectButton = () => screen.getByRole('button', { name: /connect/i });

describe('AppHeader Connect button', () => {
  beforeEach(() => {
    flags.ready = false;
    flags.variant = undefined;
  });

  // Before the variant is known, a click would open the legacy dialog even for D_TEST users.
  it('stays disabled while feature flags are loading', () => {
    renderHeaderAt('/dashboard');

    expect(connectButton()).toBeDisabled();
  });

  it('is enabled once flags have loaded', () => {
    flags.ready = true;
    renderHeaderAt('/dashboard');

    expect(connectButton()).toBeEnabled();
  });

  it('stays disabled for a D_TEST user who is already on the install page', () => {
    flags.ready = true;
    flags.variant = FEATURE_FLAG_VARIANTS.D_TEST;
    renderHeaderAt('/dashboard/install');

    expect(connectButton()).toBeDisabled();
  });
});
