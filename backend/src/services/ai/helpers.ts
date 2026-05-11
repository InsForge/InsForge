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
  inputPrice: number;
  outputPrice: number;
} {
  if (!pricing) {
    return { inputPrice: 0, outputPrice: 0 };
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

/**
 * Get provider order for sorting
 */
export function getProviderOrder(modelId: string): number {
  const companyId = modelId.split('/')[0]?.toLowerCase() || '';
  return PROVIDER_ORDER[companyId] || 999;
}
