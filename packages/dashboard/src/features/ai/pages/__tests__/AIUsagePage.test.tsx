import { render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { AIOverview } from '@insforge/shared-schemas';

const hookMock = vi.hoisted(() => ({
  result: {
    data: undefined as AIOverview | undefined,
    isLoading: false,
    isError: false,
    error: null as Error | null,
  },
}));

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (_key: string, options?: { defaultValue?: string; value?: string }) =>
      options?.defaultValue?.replace('{{value}}', options.value ?? '') ?? _key,
  }),
}));

vi.mock('#features/ai/hooks/useAIOverview', () => ({
  useAIOverview: () => hookMock.result,
}));

import AIUsagePage from '#features/ai/pages/AIUsagePage';

const overview: AIOverview = {
  key: {
    label: 'Test key',
    limit: 50,
    limitRemaining: 37.5,
    limitReset: 'monthly',
    usage: 48.61,
    usageDaily: 0.38,
    usageWeekly: 4.82,
    usageMonthly: 12.5,
    isFreeTier: false,
    observabilityAvailable: true,
  },
  charts: {
    spend: [{ label: '2026-07-15', value: 1.25 }],
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
      spend: 1.25,
      byokSpend: 0,
    },
  ],
};

describe('AIUsagePage', () => {
  beforeEach(() => {
    hookMock.result = {
      data: overview,
      isLoading: false,
      isError: false,
      error: null,
    };
  });

  it('shows spend, historical activity, and model usage in one dedicated page', () => {
    render(<AIUsagePage />);

    expect(screen.getByRole('heading', { name: 'Usage' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Summary' })).toBeInTheDocument();
    expect(
      screen.getByText('Spend reported for the active OpenRouter API key.')
    ).toBeInTheDocument();
    expect(screen.getByText('$48.61')).toBeInTheDocument();
    expect(screen.getByRole('progressbar')).toHaveAttribute('aria-valuenow', '25');
    expect(screen.getAllByText('$1.25')).toHaveLength(3);
    expect(screen.getAllByText('42')).toHaveLength(3);
    expect(screen.getAllByText('12K')).toHaveLength(3);
    expect(screen.getByText('openai/gpt-5.4')).toBeInTheDocument();
    expect(screen.getByText('OpenAI')).toBeInTheDocument();
    expect(screen.getByText('$2.00')).toBeInTheDocument();
    expect(screen.getByText('$1.00')).toBeInTheDocument();
    expect(screen.getByText('$0.00')).toBeInTheDocument();
  });

  it('shows a single management-key explanation when activity is unavailable', () => {
    hookMock.result = {
      data: {
        ...overview,
        key: {
          ...overview.key,
          observabilityAvailable: false,
          observabilityError: 'Configure a management key.',
        },
        charts: { spend: [], requests: [], tokens: [] },
        modelUsage: [],
      },
      isLoading: false,
      isError: false,
      error: null,
    };

    render(<AIUsagePage />);

    expect(screen.getByText('Configure a management key.')).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'Models' })).not.toBeInTheDocument();
  });
});
