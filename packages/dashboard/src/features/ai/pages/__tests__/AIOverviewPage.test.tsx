import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { AIOverview } from '@insforge/shared-schemas';

const hookMocks = vi.hoisted(() => ({
  rotateOpenRouterKey: vi.fn(),
  isRotating: false,
  overviewResult: {
    data: {
      key: {
        label: 'Test key',
        limit: 50,
        limitRemaining: 37.53,
        limitReset: 'monthly',
        usage: 48.61,
        usageDaily: 0.38,
        usageWeekly: 4.82,
        usageMonthly: 12.47,
        isFreeTier: false,
        observabilityAvailable: false,
        observabilityError: 'Activity requires a management key.',
      },
      charts: {
        spend: [],
        requests: [],
        tokens: [],
      },
    },
    isLoading: false,
    isError: false,
    error: null as Error | null,
  } as {
    data?: AIOverview;
    isLoading: boolean;
    isError: boolean;
    error: Error | null;
  },
}));

vi.mock('#components', () => ({
  CodeEditor: ({ code }: { code: string }) => <pre data-testid="code-editor">{code}</pre>,
}));

vi.mock('#features/ai/hooks/useAIModelCredits', () => ({
  useAIModelCredits: () => ({
    data: undefined,
    isLoading: false,
    error: null,
  }),
}));

vi.mock('#features/ai/hooks/useAIOverview', () => ({
  useAIOverview: () => hookMocks.overviewResult,
}));

vi.mock('#features/ai/hooks/useOpenRouterKey', () => ({
  useOpenRouterKey: () => ({
    data: {
      apiKey: 'sk-or-current-key',
      maskedKey: 'sk-or-cu••••••••-key',
    },
    isLoading: false,
    error: null,
  }),
  useRotateOpenRouterKey: () => ({
    mutateAsync: hookMocks.rotateOpenRouterKey,
    isPending: hookMocks.isRotating,
  }),
}));

vi.mock('#features/ai/constants', () => {
  const TestModelIcon = ({ className }: { className?: string }) => (
    <span data-testid="model-icon" className={className} />
  );

  return {
    CODE_TAB_LANGUAGE: {
      sdk: 'javascript',
      python: 'python',
      http: 'http',
    },
    OVERVIEW_QUICK_START_MODELS: [
      {
        id: 'openai/gpt-test',
        label: 'GPT Test',
        icon: TestModelIcon,
      },
    ],
    getOverviewCodeSnippets: () => ({
      sdk: 'const client = new OpenAI();',
      python: 'client = OpenAI()',
      http: 'POST /chat/completions',
    }),
  };
});

vi.mock('#lib/config/DashboardHostContext', () => ({
  useDashboardHost: () => ({
    mode: 'cloud-hosting',
  }),
}));

import AIOverviewPage from '#features/ai/pages/AIOverviewPage';

describe('AIOverviewPage OpenRouter key rotation', () => {
  beforeEach(() => {
    hookMocks.rotateOpenRouterKey.mockReset();
    hookMocks.rotateOpenRouterKey.mockResolvedValue({
      apiKey: 'sk-or-rotated-key',
      maskedKey: 'sk-or-ro••••••••-key',
    });
    hookMocks.isRotating = false;
    hookMocks.overviewResult = {
      data: {
        key: {
          label: 'Test key',
          limit: 50,
          limitRemaining: 37.53,
          limitReset: 'monthly',
          usage: 48.61,
          usageDaily: 0.38,
          usageWeekly: 4.82,
          usageMonthly: 12.47,
          isFreeTier: false,
          observabilityAvailable: false,
          observabilityError: 'Activity requires a management key.',
        },
        charts: {
          spend: [],
          requests: [],
          tokens: [],
        },
      },
      isLoading: false,
      isError: false,
      error: null,
    };
  });

  it('confirms before rotating the active OpenRouter key', async () => {
    const user = userEvent.setup({ delay: null });

    render(
      <MemoryRouter>
        <AIOverviewPage />
      </MemoryRouter>
    );

    await user.click(screen.getByRole('button', { name: /^Rotate$/ }));

    expect(screen.getByText('Rotate OpenRouter key?')).toBeInTheDocument();
    expect(screen.getByText(/current API key will stop working immediately/i)).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Rotate key' }));

    await waitFor(() => {
      expect(hookMocks.rotateOpenRouterKey).toHaveBeenCalledOnce();
    });
  });

  it('does not rotate when the confirmation is cancelled', async () => {
    const user = userEvent.setup({ delay: null });

    render(
      <MemoryRouter>
        <AIOverviewPage />
      </MemoryRouter>
    );

    await user.click(screen.getByRole('button', { name: /^Rotate$/ }));
    await user.click(screen.getByRole('button', { name: 'Cancel' }));

    expect(hookMocks.rotateOpenRouterKey).not.toHaveBeenCalled();
  });

  it('keeps only a compact activity preview and links to the Usage page', () => {
    render(
      <MemoryRouter>
        <AIOverviewPage />
      </MemoryRouter>
    );

    expect(screen.getByRole('heading', { name: 'Spend' })).toBeInTheDocument();
    expect(screen.getByText('Historical spend for this key.')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'View usage' })).toHaveAttribute(
      'href',
      '/dashboard/ai/usage'
    );
    expect(screen.getByText('Activity requires a management key.')).toBeInTheDocument();
    expect(screen.queryByText('$48.61')).not.toBeInTheDocument();
    expect(screen.queryByRole('progressbar')).not.toBeInTheDocument();
  });

  it('renders the historical charts when OpenRouter activity is available', () => {
    hookMocks.overviewResult.data = {
      ...hookMocks.overviewResult.data!,
      key: {
        ...hookMocks.overviewResult.data!.key,
        observabilityAvailable: true,
        observabilityError: undefined,
      },
      charts: {
        spend: [{ label: '2026-07-15', value: 12.34 }],
        requests: [{ label: '2026-07-15', value: 42 }],
        tokens: [{ label: '2026-07-15', value: 12000 }],
      },
      modelUsage: [
        {
          model: 'openai/gpt-5.4',
          providers: ['OpenAI'],
          requests: 42,
          promptTokens: 9000,
          completionTokens: 2500,
          reasoningTokens: 500,
          totalTokens: 12000,
          spend: 12.34,
          byokSpend: 0,
        },
      ],
    };

    render(
      <MemoryRouter>
        <AIOverviewPage />
      </MemoryRouter>
    );

    expect(screen.getAllByText('$12.34')).toHaveLength(2);
    expect(screen.queryByText('Requests')).not.toBeInTheDocument();
    expect(screen.queryByText('Tokens')).not.toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'Models' })).not.toBeInTheDocument();
    expect(screen.queryByText('openai/gpt-5.4')).not.toBeInTheDocument();
    expect(screen.queryByText('Activity requires a management key.')).not.toBeInTheDocument();
  });

  it('omits the limit row for an unlimited key', () => {
    hookMocks.overviewResult.data = {
      ...hookMocks.overviewResult.data!,
      key: {
        ...hookMocks.overviewResult.data!.key,
        limit: null,
        limitRemaining: null,
        limitReset: null,
      },
    };

    render(
      <MemoryRouter>
        <AIOverviewPage />
      </MemoryRouter>
    );

    expect(screen.queryByText('Unlimited key')).not.toBeInTheDocument();
    expect(screen.queryByText('Never resets')).not.toBeInTheDocument();
    expect(screen.queryByRole('progressbar')).not.toBeInTheDocument();
  });

  it('shows a sanitized OpenRouter usage error', () => {
    hookMocks.overviewResult = {
      data: undefined,
      isLoading: false,
      isError: true,
      error: new Error('Unable to load usage from OpenRouter.'),
    };

    render(
      <MemoryRouter>
        <AIOverviewPage />
      </MemoryRouter>
    );

    expect(screen.getByText('Unable to load usage from OpenRouter.')).toBeInTheDocument();
  });
});
