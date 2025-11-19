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
  const supportedModalities: ModalitySchema[] = ['text', 'image'];
  const filtered = modalities.filter((m): m is ModalitySchema =>
    supportedModalities.includes(m as ModalitySchema)
  );
  return sortModalities(filtered) as ModalitySchema[];
}

/**
 * Calculate price level (0-3)
 */
export function calculatePriceLevel(pricing: RawOpenRouterModel['pricing']): number {
  if (!pricing) {
    return 0;
  }
  if (pricing.prompt === '0' && pricing.completion === '0') {
    return 0;
  }

  const promptCostPerToken = parseFloat(pricing.prompt) || 0;
  const completionCostPerToken = parseFloat(pricing.completion) || 0;
  const avgCostPer1M = ((promptCostPerToken + completionCostPerToken) / 2) * 1000000;

  if (avgCostPer1M <= 3) {
    return 1;
  }
  if (avgCostPer1M <= 15) {
    return 2;
  }
  return 3;
}

/**
 * Get provider order for sorting
 */
export function getProviderOrder(modelId: string): number {
  const companyId = modelId.split('/')[0]?.toLowerCase() || '';
  return PROVIDER_ORDER[companyId] || 999;
}
