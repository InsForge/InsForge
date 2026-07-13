import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const hookMocks = vi.hoisted(() => ({
  rotateOpenRouterKey: vi.fn(),
  isRotating: false,
}));

vi.mock('#components', () => ({
  CodeEditor: ({ code }: { code: string }) => <pre data-testid="code-editor">{code}</pre>,
}));

vi.mock('#features/ai/hooks/useAIOverview', () => ({
  useAIOverview: () => ({
    data: {
      key: {
        limit: null,
        limitRemaining: null,
        usage: 0,
        usageDaily: 0,
        usageWeekly: 0,
        usageMonthly: 0,
        observabilityAvailable: false,
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
  }),
}));

vi.mock('#features/ai/hooks/useAIModelCredits', () => ({
  useAIModelCredits: () => ({
    data: undefined,
    isLoading: false,
    error: null,
  }),
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
});
