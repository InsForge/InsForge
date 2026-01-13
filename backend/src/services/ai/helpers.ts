import type { RawOpenRouterModel } from '@/types/ai.js';
import type { ModalitySchema } from '@insforge/shared-schemas';

const MODALITY_ORDER = ['text', 'image', 'audio', 'video', 'file'];
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
  return [...modalities].sort((a, b) => {
    const aIndex = MODALITY_ORDER.indexOf(a);
    const bIndex = MODALITY_ORDER.indexOf(b);
    return aIndex - bIndex;
  });
}

/**
 * Filter to only supported modalities and sort
 */
export function filterAndSortModalities(modalities: string[]): ModalitySchema[] {
  const supportedModalities: ModalitySchema[] = ['text', 'image', 'audio'];
  const filtered = modalities.filter((m): m is ModalitySchema =>
    supportedModalities.includes(m as ModalitySchema)
  );
  return sortModalities(filtered) as ModalitySchema[];
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
