import type { RawOpenRouterModel } from '@/types/ai.js';

const MODALITY_ORDER = ['text', 'image', 'audio', 'video', 'file', 'embeddings'];
const PROVIDER_ORDER: Record<string, number> = {
  openai: 1,
  anthropic: 2,
  google: 3,
  amazon: 4,
};

/**
 * Sort modalities by predefined order
 */
export function sortModalities(modalities: string[]): string[] {
  return [...new Set(modalities.filter((modality) => modality.trim().length > 0))].sort((a, b) => {
    const aIndex = MODALITY_ORDER.indexOf(a);
    const bIndex = MODALITY_ORDER.indexOf(b);
    if (aIndex === -1 && bIndex === -1) {
      return a.localeCompare(b);
    }
    if (aIndex === -1) {
      return 1;
    }
    if (bIndex === -1) {
      return -1;
    }
    return aIndex - bIndex;
  });
}

/**
 * Preserve all OpenRouter modalities and sort known ones into a stable order.
 */
export function normalizeModalities(modalities: string[]): string[] {
  return sortModalities(modalities);
}

/**
 * Calculate price per million tokens from OpenRouter pricing
 * OpenRouter pricing is per token, we convert to per million tokens
 */
export function calculatePricePerMillion(pricing: RawOpenRouterModel['pricing']): {
  inputPrice?: number;
  outputPrice?: number;
} {
  if (!pricing) {
    return {};
  }

  const promptCostPerToken = parseFloat(pricing.prompt) || 0;
  const completionCostPerToken = parseFloat(pricing.completion) || 0;

  // Convert from cost per token to cost per million tokens
  // Round to 6 decimal places to avoid floating point precision issues
  const inputPrice = Math.round(promptCostPerToken * 1_000_000 * 1_000_000) / 1_000_000;
  const outputPrice = Math.round(completionCostPerToken * 1_000_000 * 1_000_000) / 1_000_000;

  return {
    inputPrice: Math.max(0, inputPrice), // Ensure non-negative
    outputPrice: Math.max(0, outputPrice), // Ensure non-negative
  };
}

export function calculateTokenPrices(
  pricing: RawOpenRouterModel['pricing'],
  inputModalities: string[],
  outputModalities: string[]
): {
  inputPrice?: number;
  outputPrice?: number;
  inputPriceLabel?: string;
  outputPriceLabel?: string;
} {
  if (!pricing) {
    return {};
  }

  const inputIsTokenPriced = inputModalities.some((modality) =>
    ['text', 'file', 'embeddings'].includes(modality)
  );
  const outputIsTokenPriced = outputModalities.includes('text');
  const prices = calculatePricePerMillion(pricing);

  return {
    inputPrice: inputIsTokenPriced ? prices.inputPrice : undefined,
    outputPrice: outputIsTokenPriced ? prices.outputPrice : undefined,
    inputPriceLabel: inputIsTokenPriced ? formatTokenPriceLabel(prices.inputPrice) : undefined,
    outputPriceLabel: outputIsTokenPriced ? formatTokenPriceLabel(prices.outputPrice) : undefined,
  };
}

function formatTokenPriceLabel(price: number | undefined): string | undefined {
  if (price === undefined) {
    return undefined;
  }
  if (price === 0) {
    return 'Free';
  }
  return `$${formatTokenPrice(price)} / M tokens`;
}

function formatTokenPrice(price: number): string {
  if (price < 0.01) {
    return price.toFixed(4);
  }
  if (price < 1) {
    return price.toFixed(2);
  }
  return price.toFixed(1);
}

/**
 * Get provider order for sorting
 */
export function getProviderOrder(modelId: string): number {
  const companyId = modelId.split('/')[0]?.toLowerCase() || '';
  return PROVIDER_ORDER[companyId] || 999;
}
