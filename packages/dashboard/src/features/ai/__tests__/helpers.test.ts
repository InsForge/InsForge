import { describe, expect, it } from 'vitest';
import type { AIModelSchema } from '@insforge/shared-schemas';
import {
  getProviderIdFromModelId,
  getProviderDisplayName,
  getProviderDisplayOrder,
  filterModelsByProvider,
  filterModelsByModalities,
  generateProviderTabs,
  formatTokenCount,
  getFriendlyModelName,
  toModelOption,
  formatCredits,
  formatPrice,
  formatInputPrice,
  formatOutputPrice,
  formatModality,
  formatReleasedDate,
} from '#features/ai/helpers';

function model(overrides: Partial<AIModelSchema> & { modelId: string }): AIModelSchema {
  return {
    id: overrides.modelId,
    modelId: overrides.modelId,
    provider: 'openrouter',
    created: 1700000000,
    inputModality: ['text'],
    outputModality: ['text'],
    ...overrides,
  };
}

describe('getProviderIdFromModelId', () => {
  it('extracts provider from standard model ID', () => {
    expect(getProviderIdFromModelId('openai/gpt-5.5')).toBe('openai');
  });

  it('extracts provider from multi-segment model ID', () => {
    expect(getProviderIdFromModelId('google/gemini-2.5-pro')).toBe('google');
  });

  it('returns empty string for model ID without slash', () => {
    expect(getProviderIdFromModelId('standalone')).toBe('standalone');
  });

  it('returns empty string for empty input', () => {
    expect(getProviderIdFromModelId('')).toBe('');
  });
});

describe('getProviderDisplayName', () => {
  it('returns display name for known providers', () => {
    expect(getProviderDisplayName('openai')).toBe('OpenAI');
    expect(getProviderDisplayName('anthropic')).toBe('Anthropic');
    expect(getProviderDisplayName('google')).toBe('Google');
    expect(getProviderDisplayName('x-ai')).toBe('xAI');
    expect(getProviderDisplayName('deepseek')).toBe('DeepSeek');
  });

  it('is case-insensitive', () => {
    expect(getProviderDisplayName('OpenAI')).toBe('OpenAI');
    expect(getProviderDisplayName('GOOGLE')).toBe('Google');
  });

  it('capitalizes first letter for unknown providers', () => {
    expect(getProviderDisplayName('mistral')).toBe('Mistral');
    expect(getProviderDisplayName('meta')).toBe('Meta');
  });

  it('handles empty string', () => {
    expect(getProviderDisplayName('')).toBe('');
  });
});

describe('getProviderDisplayOrder', () => {
  it('returns defined order for known providers', () => {
    expect(getProviderDisplayOrder('openai')).toBe(1);
    expect(getProviderDisplayOrder('anthropic')).toBe(2);
    expect(getProviderDisplayOrder('google')).toBe(3);
  });

  it('returns fallback 500 for unknown providers', () => {
    expect(getProviderDisplayOrder('mistral')).toBe(500);
    expect(getProviderDisplayOrder('meta')).toBe(500);
  });

  it('is case-insensitive', () => {
    expect(getProviderDisplayOrder('OpenAI')).toBe(1);
  });
});

describe('filterModelsByProvider', () => {
  const models = [
    model({ modelId: 'openai/gpt-5.5' }),
    model({ modelId: 'openai/gpt-4o' }),
    model({ modelId: 'anthropic/claude-sonnet' }),
    model({ modelId: 'mistral/large' }),
  ];

  it('filters models by exact provider ID', () => {
    const result = filterModelsByProvider(models, 'openai');
    expect(result).toHaveLength(2);
    expect(result.every((m) => m.modelId.startsWith('openai/'))).toBe(true);
  });

  it('returns empty array for nonexistent provider', () => {
    expect(filterModelsByProvider(models, 'nonexistent')).toHaveLength(0);
  });

  it('filters "other" tab to models without provider logos', () => {
    const result = filterModelsByProvider(models, 'other');
    // mistral has no logo, so it goes to "other"
    expect(result).toHaveLength(1);
    expect(result[0].modelId).toBe('mistral/large');
  });
});

describe('filterModelsByModalities', () => {
  const models = [
    model({ modelId: 'a/text', inputModality: ['text'], outputModality: ['text'] }),
    model({
      modelId: 'b/multimodal',
      inputModality: ['text', 'image'],
      outputModality: ['text', 'image'],
    }),
    model({ modelId: 'c/embed', inputModality: ['text'], outputModality: ['embeddings'] }),
  ];

  it('returns all models when no modalities are required', () => {
    expect(filterModelsByModalities(models, [], [])).toHaveLength(3);
  });

  it('filters by required input modality', () => {
    const result = filterModelsByModalities(models, ['image'], []);
    expect(result).toHaveLength(1);
    expect(result[0].modelId).toBe('b/multimodal');
  });

  it('filters by required output modality', () => {
    const result = filterModelsByModalities(models, [], ['embeddings']);
    expect(result).toHaveLength(1);
    expect(result[0].modelId).toBe('c/embed');
  });

  it('applies both input and output filters', () => {
    const result = filterModelsByModalities(models, ['text'], ['text']);
    expect(result).toHaveLength(2); // a/text and b/multimodal
  });

  it('returns empty array for empty model list', () => {
    expect(filterModelsByModalities([], ['text'], ['text'])).toEqual([]);
  });

  it('returns empty array for null/undefined model list', () => {
    expect(filterModelsByModalities(null as any, ['text'], ['text'])).toEqual([]);
  });
});

describe('generateProviderTabs', () => {
  it('generates tabs for providers with logos and adds "Other" for unknown', () => {
    const models = [
      model({ modelId: 'openai/gpt-5.5' }),
      model({ modelId: 'anthropic/claude-sonnet' }),
      model({ modelId: 'mistral/large' }),
    ];

    const tabs = generateProviderTabs(models);

    expect(tabs.find((t) => t.id === 'openai')).toBeDefined();
    expect(tabs.find((t) => t.id === 'anthropic')).toBeDefined();
    expect(tabs.find((t) => t.id === 'other')).toBeDefined();
    // mistral should NOT have its own tab
    expect(tabs.find((t) => t.id === 'mistral')).toBeUndefined();
  });

  it('sorts tabs by display order', () => {
    const models = [
      model({ modelId: 'google/gemini' }),
      model({ modelId: 'openai/gpt' }),
      model({ modelId: 'anthropic/claude' }),
    ];

    const tabs = generateProviderTabs(models);
    const ids = tabs.map((t) => t.id);

    expect(ids.indexOf('openai')).toBeLessThan(ids.indexOf('anthropic'));
    expect(ids.indexOf('anthropic')).toBeLessThan(ids.indexOf('google'));
  });

  it('does not add "Other" tab when all providers have logos', () => {
    const models = [model({ modelId: 'openai/gpt' }), model({ modelId: 'google/gemini' })];

    const tabs = generateProviderTabs(models);

    expect(tabs.find((t) => t.id === 'other')).toBeUndefined();
  });

  it('returns empty tabs for empty model list', () => {
    expect(generateProviderTabs([])).toEqual([]);
  });
});

describe('formatTokenCount', () => {
  it('formats millions', () => {
    expect(formatTokenCount(1_500_000)).toBe('1.5M');
    expect(formatTokenCount(1_000_000)).toBe('1.0M');
  });

  it('formats thousands', () => {
    expect(formatTokenCount(128_000)).toBe('128.0K');
    expect(formatTokenCount(1_000)).toBe('1.0K');
  });

  it('formats small numbers as-is', () => {
    expect(formatTokenCount(999)).toBe('999');
    expect(formatTokenCount(0)).toBe('0');
  });
});

describe('getFriendlyModelName', () => {
  it('converts kebab-case to Title Case', () => {
    expect(getFriendlyModelName('gpt-4o-mini')).toBe('Gpt 4o Mini');
  });

  it('handles single word', () => {
    expect(getFriendlyModelName('claude')).toBe('Claude');
  });

  it('handles empty string', () => {
    expect(getFriendlyModelName('')).toBe('');
  });
});

describe('toModelOption', () => {
  it('maps AIModelSchema to ModelOption', () => {
    const result = toModelOption(
      model({ modelId: 'openai/gpt-5.5', inputPrice: 1, outputPrice: 2 })
    );

    expect(result.providerName).toBe('OpenAI');
    expect(result.modelName).toBe('Gpt 5.5');
    expect(result.inputPrice).toBe(1);
    expect(result.outputPrice).toBe(2);
  });
});

describe('formatCredits', () => {
  it('formats thousands with K suffix', () => {
    expect(formatCredits(1500)).toBe('1.5K');
  });

  it('formats small values with 2 decimal places', () => {
    expect(formatCredits(42.5)).toBe('42.50');
  });

  it('formats zero', () => {
    expect(formatCredits(0)).toBe('0.00');
  });
});

describe('formatPrice', () => {
  it('returns dash for undefined', () => {
    expect(formatPrice(undefined)).toBe('-');
  });

  it('returns "Free" for zero', () => {
    expect(formatPrice(0)).toBe('Free');
  });

  it('formats very small prices with 4 decimals', () => {
    expect(formatPrice(0.005)).toBe('$0.0050');
  });

  it('formats sub-dollar prices with 2 decimals', () => {
    expect(formatPrice(0.5)).toBe('$0.50');
  });

  it('formats dollar+ prices with 1 decimal', () => {
    expect(formatPrice(10)).toBe('$10.0');
  });
});

describe('formatInputPrice / formatOutputPrice', () => {
  it('prefers priceLabel when available', () => {
    expect(formatInputPrice({ inputPrice: 1, inputPriceLabel: '$1.0 / M tokens' })).toBe(
      '$1.0 / M tokens'
    );
    expect(formatOutputPrice({ outputPrice: 2, outputPriceLabel: 'Free' })).toBe('Free');
  });

  it('falls back to formatPrice when label is undefined', () => {
    expect(formatInputPrice({ inputPrice: 1, inputPriceLabel: undefined })).toBe('$1.0');
    expect(formatOutputPrice({ outputPrice: undefined, outputPriceLabel: undefined })).toBe('-');
  });
});

describe('formatModality', () => {
  it('capitalizes first letter', () => {
    expect(formatModality('text')).toBe('Text');
    expect(formatModality('embeddings')).toBe('Embeddings');
  });

  it('handles empty string', () => {
    expect(formatModality('')).toBe('');
  });
});

describe('formatReleasedDate', () => {
  it('formats Unix timestamp to MM/DD/YYYY', () => {
    // 1700000000 = Nov 14, 2023
    const result = formatReleasedDate(1700000000);
    expect(result).toMatch(/^\d{2}\/\d{2}\/\d{4}$/);
  });

  it('returns dash for undefined', () => {
    expect(formatReleasedDate(undefined)).toBe('-');
  });

  it('returns dash for null', () => {
    expect(formatReleasedDate(null as any)).toBe('-');
  });
});
