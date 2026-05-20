import { describe, expect, it } from 'vitest';
import {
  sortModalities,
  normalizeModalities,
  calculatePricePerMillion,
  calculateTokenPrices,
  getProviderOrder,
} from '../../src/services/ai/helpers';
import type { RawOpenRouterModel } from '../../src/types/ai';

describe('sortModalities', () => {
  it('sorts known modalities by predefined order', () => {
    expect(sortModalities(['video', 'text', 'image'])).toEqual(['text', 'image', 'video']);
  });

  it('places unknown modalities after known ones, sorted alphabetically', () => {
    expect(sortModalities(['transcription', 'text', 'audio'])).toEqual([
      'text',
      'audio',
      'transcription',
    ]);
  });

  it('sorts multiple unknown modalities alphabetically among themselves', () => {
    expect(sortModalities(['zebra', 'alpha', 'text'])).toEqual(['text', 'alpha', 'zebra']);
  });

  it('deduplicates entries', () => {
    expect(sortModalities(['text', 'text', 'image', 'image'])).toEqual(['text', 'image']);
  });

  it('filters out empty and whitespace-only strings', () => {
    expect(sortModalities(['', 'text', '  ', 'image'])).toEqual(['text', 'image']);
  });

  it('returns an empty array for empty input', () => {
    expect(sortModalities([])).toEqual([]);
  });

  it('handles all known modalities in the correct canonical order', () => {
    expect(sortModalities(['embeddings', 'file', 'video', 'audio', 'image', 'text'])).toEqual([
      'text',
      'image',
      'audio',
      'video',
      'file',
      'embeddings',
    ]);
  });

  it('handles a single modality', () => {
    expect(sortModalities(['embeddings'])).toEqual(['embeddings']);
  });
});

describe('normalizeModalities', () => {
  it('delegates to sortModalities (dedup + sort)', () => {
    expect(normalizeModalities(['image', 'text', 'image'])).toEqual(['text', 'image']);
  });
});

describe('calculatePricePerMillion', () => {
  it('converts per-token pricing to per-million-tokens', () => {
    const result = calculatePricePerMillion({
      prompt: '0.000001',
      completion: '0.000002',
    });
    expect(result.inputPrice).toBe(1);
    expect(result.outputPrice).toBe(2);
  });

  it('handles zero pricing', () => {
    const result = calculatePricePerMillion({
      prompt: '0',
      completion: '0',
    });
    expect(result.inputPrice).toBe(0);
    expect(result.outputPrice).toBe(0);
  });

  it('returns empty object when pricing is undefined', () => {
    const result = calculatePricePerMillion(undefined as unknown as RawOpenRouterModel['pricing']);
    expect(result).toEqual({});
  });

  it('treats non-numeric pricing strings as zero', () => {
    const result = calculatePricePerMillion({
      prompt: 'abc',
      completion: '',
    });
    expect(result.inputPrice).toBe(0);
    expect(result.outputPrice).toBe(0);
  });

  it('handles very small prices (embedding models)', () => {
    const result = calculatePricePerMillion({
      prompt: '0.00000002',
      completion: '0',
    });
    expect(result.inputPrice).toBeCloseTo(0.02, 4);
    expect(result.outputPrice).toBe(0);
  });

  it('ensures non-negative prices', () => {
    const result = calculatePricePerMillion({
      prompt: '0.000001',
      completion: '0.000001',
    });
    expect(result.inputPrice).toBeGreaterThanOrEqual(0);
    expect(result.outputPrice).toBeGreaterThanOrEqual(0);
  });
});

describe('calculateTokenPrices', () => {
  const textPricing = {
    prompt: '0.000001',
    completion: '0.000002',
  };

  it('returns token-priced labels for text→text models', () => {
    const result = calculateTokenPrices(textPricing, ['text'], ['text']);
    expect(result.inputPrice).toBe(1);
    expect(result.outputPrice).toBe(2);
    expect(result.inputPriceLabel).toBe('$1.0 / M tokens');
    expect(result.outputPriceLabel).toBe('$2.0 / M tokens');
  });

  it('returns inputPrice but not outputPrice for embedding models', () => {
    const result = calculateTokenPrices(textPricing, ['text'], ['embeddings']);
    expect(result.inputPrice).toBe(1);
    expect(result.outputPrice).toBeUndefined();
    expect(result.inputPriceLabel).toBe('$1.0 / M tokens');
    expect(result.outputPriceLabel).toBeUndefined();
  });

  it('returns undefined prices for image→image models', () => {
    const result = calculateTokenPrices(textPricing, ['image'], ['image']);
    expect(result.inputPrice).toBeUndefined();
    expect(result.outputPrice).toBeUndefined();
    expect(result.inputPriceLabel).toBeUndefined();
    expect(result.outputPriceLabel).toBeUndefined();
  });

  it('returns inputPrice for file input modality', () => {
    const result = calculateTokenPrices(textPricing, ['file'], ['text']);
    expect(result.inputPrice).toBe(1);
    expect(result.inputPriceLabel).toBe('$1.0 / M tokens');
  });

  it('returns "Free" label when price is zero', () => {
    const result = calculateTokenPrices({ prompt: '0', completion: '0' }, ['text'], ['text']);
    expect(result.inputPriceLabel).toBe('Free');
    expect(result.outputPriceLabel).toBe('Free');
  });

  it('returns empty object when pricing is undefined', () => {
    const result = calculateTokenPrices(
      undefined as unknown as RawOpenRouterModel['pricing'],
      ['text'],
      ['text']
    );
    expect(result).toEqual({});
  });

  it('formats small prices with 4 decimal places', () => {
    const result = calculateTokenPrices(
      { prompt: '0.000000005', completion: '0' },
      ['text'],
      ['text']
    );
    // 0.000000005 * 1_000_000 = 0.005
    expect(result.inputPriceLabel).toBe('$0.0050 / M tokens');
  });

  it('formats medium prices with 2 decimal places', () => {
    const result = calculateTokenPrices(
      { prompt: '0.0000005', completion: '0' },
      ['text'],
      ['text']
    );
    // 0.0000005 * 1_000_000 = 0.5
    expect(result.inputPriceLabel).toBe('$0.50 / M tokens');
  });

  it('formats large prices with 1 decimal place', () => {
    const result = calculateTokenPrices({ prompt: '0.00006', completion: '0' }, ['text'], ['text']);
    // 0.00006 * 1_000_000 = 60
    expect(result.inputPriceLabel).toBe('$60.0 / M tokens');
  });

  it('handles multimodal input (text + image) with text output', () => {
    const result = calculateTokenPrices(textPricing, ['text', 'image'], ['text']);
    expect(result.inputPrice).toBe(1);
    expect(result.outputPrice).toBe(2);
  });

  it('handles audio-only model (no token pricing)', () => {
    const result = calculateTokenPrices(
      { prompt: '0.111', completion: '0' },
      ['audio'],
      ['transcription']
    );
    expect(result.inputPrice).toBeUndefined();
    expect(result.outputPrice).toBeUndefined();
  });
});

describe('getProviderOrder', () => {
  it('returns correct order for known providers', () => {
    expect(getProviderOrder('openai/gpt-5.5')).toBe(1);
    expect(getProviderOrder('anthropic/claude-sonnet-4.6')).toBe(2);
    expect(getProviderOrder('google/gemini-2.5-pro')).toBe(3);
    expect(getProviderOrder('amazon/nova-pro-v2')).toBe(4);
  });

  it('returns 999 for unknown providers', () => {
    expect(getProviderOrder('mistral/mistral-large')).toBe(999);
    expect(getProviderOrder('meta/llama-4')).toBe(999);
  });

  it('handles model IDs without a slash', () => {
    expect(getProviderOrder('standalone-model')).toBe(999);
  });

  it('handles empty string', () => {
    expect(getProviderOrder('')).toBe(999);
  });

  it('is case-insensitive for provider matching', () => {
    expect(getProviderOrder('OpenAI/gpt-5.5')).toBe(1);
    expect(getProviderOrder('GOOGLE/gemini-2.5-pro')).toBe(3);
  });
});
