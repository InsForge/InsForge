import {
  ModalitySchema,
  AIModelSchema,
  AIConfigurationWithUsageSchema,
} from '@insforge/shared-schemas';
export interface ModelOption {
  id: string;
  modelId: string;
  modelName: string;
  providerName: string;
  logo: React.ComponentType<React.SVGProps<SVGSVGElement>> | undefined;
  inputModality: ModalitySchema[];
  outputModality: ModalitySchema[];
  inputPrice?: number; // Price per million tokens in USD
  outputPrice?: number; // Price per million tokens in USD
  usageStats?: {
    totalRequests: number;
  };
  systemPrompt?: string | null;
}

import GrokIcon from '@/assets/logos/grok.svg?react';
import GeminiIcon from '@/assets/logos/gemini.svg?react';
import ClaudeIcon from '@/assets/logos/claude_code.svg?react';
import OpenAIIcon from '@/assets/logos/openai.svg?react';
import AmazonIcon from '@/assets/logos/amazon.svg?react';
import DeepseekIcon from '@/assets/logos/deepseek.svg?react';
import QwenIcon from '@/assets/logos/qwen.svg?react';

// Provider tab configuration
export interface ProviderTab {
  id: string;
  displayName: string;
  logo: React.FunctionComponent<React.SVGProps<SVGSVGElement>> | undefined;
}

// Extract provider ID from modelId (e.g., "openai/gpt-4o" -> "openai")
export const getProviderIdFromModelId = (modelId: string): string => {
  return modelId.split('/')[0] || '';
};

export const getProviderDisplayName = (providerId: string): string => {
  const providerMap: Record<string, string> = {
    openai: 'OpenAI',
    anthropic: 'Anthropic',
    google: 'Google',
    openrouter: 'OpenRouter',
    azure: 'Azure',
    amazon: 'Amazon',
    'x-ai': 'xAI',
    huggingface: 'HuggingFace',
    deepseek: 'DeepSeek',
    qwen: 'Qwen',
  };

  return (
    providerMap[providerId.toLowerCase()] ||
    providerId.charAt(0).toUpperCase() + providerId.slice(1)
  );
};

export const getProviderLogo = (
  providerId: string
): React.FunctionComponent<React.SVGProps<SVGSVGElement>> | undefined => {
  const logoMap: Record<string, React.FunctionComponent<React.SVGProps<SVGSVGElement>>> = {
    anthropic: ClaudeIcon,
    openai: OpenAIIcon,
    google: GeminiIcon,
    'x-ai': GrokIcon,
    amazon: AmazonIcon,
    deepseek: DeepseekIcon,
    qwen: QwenIcon,
  };
  return logoMap[providerId];
};

// Filter models by provider ID
export const filterModelsByProvider = (
  models: AIModelSchema[],
  providerId: string
): AIModelSchema[] => {
  if (providerId === 'other') {
    // "other" tab contains models whose provider has no logo
    return models.filter((model) => {
      const modelProviderId = getProviderIdFromModelId(model.modelId);
      return !getProviderLogo(modelProviderId);
    });
  }
  return models.filter((model) => getProviderIdFromModelId(model.modelId) === providerId);
};

// Dynamically generate provider tabs from available models
// Providers with logos get their own tab, others go to "Other"
export const getProvidersFromModels = (models: AIModelSchema[]): ProviderTab[] => {
  // Extract unique provider IDs from models
  const providerIds = new Set<string>();
  models.forEach((model) => {
    const providerId = getProviderIdFromModelId(model.modelId);
    if (providerId) {
      providerIds.add(providerId);
    }
  });

  // Separate providers with logos (main) from those without (other)
  const mainProviders: ProviderTab[] = [];
  let hasOtherProviders = false;

  providerIds.forEach((providerId) => {
    const logo = getProviderLogo(providerId);
    if (logo) {
      mainProviders.push({
        id: providerId,
        displayName: getProviderDisplayName(providerId),
        logo,
      });
    } else {
      hasOtherProviders = true;
    }
  });

  // Sort main providers by display name
  mainProviders.sort((a, b) => a.displayName.localeCompare(b.displayName));

  // Add "Other" tab at the end if there are providers without logos
  if (hasOtherProviders) {
    mainProviders.push({
      id: 'other',
      displayName: 'Other',
      logo: undefined,
    });
  }

  return mainProviders;
};

export const formatTokenCount = (count: number): string => {
  if (count >= 1000000) {
    return `${(count / 1000000).toFixed(1)}M`;
  } else if (count >= 1000) {
    return `${(count / 1000).toFixed(1)}K`;
  }
  return count.toString();
};

// Helper function to filter AI models based on selected modalities
export const filterModelsByModalities = (
  models: AIModelSchema[],
  selectedInputModalities: ModalitySchema[],
  selectedOutputModalities: ModalitySchema[]
): AIModelSchema[] => {
  if (!models?.length) {
    return [];
  }

  return models.filter((model) => {
    const inputModalities = new Set(model.inputModality);
    const outputModalities = new Set(model.outputModality);
    return (
      selectedInputModalities.every((m) => inputModalities.has(m)) &&
      selectedOutputModalities.every((m) => outputModalities.has(m))
    );
  });
};

// Helper function to get friendly model name from model ID
export const getFriendlyModelName = (rawModelName: string): string => {
  // Convert kebab-case to Title Case
  return rawModelName
    .split('-')
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(' ');
};

export function toModelOption(model: AIModelSchema | AIConfigurationWithUsageSchema): ModelOption {
  const [rawProviderId, rawModelName] = model.modelId.split('/');

  return {
    ...model,
    modelName: getFriendlyModelName(rawModelName),
    providerName: getProviderDisplayName(rawProviderId),
    logo: getProviderLogo(rawProviderId),
  };
}

// Sort models with configured ones at the end
export const sortModelsByConfigurationStatus = (
  models: ModelOption[],
  configuredModelIds: string[]
): ModelOption[] => {
  return [...models].sort((a, b) => {
    const aConfigured = configuredModelIds.includes(a.modelId);
    const bConfigured = configuredModelIds.includes(b.modelId);

    if (aConfigured === bConfigured) {
      return 0;
    }
    return aConfigured ? 1 : -1;
  });
};

// Sorting types
export type SortField = 'inputPrice' | 'outputPrice' | 'requests';
export type SortDirection = 'asc' | 'desc';

// Format credits display
export const formatCredits = (remaining: number): string => {
  if (remaining >= 1000) {
    return `${(remaining / 1000).toFixed(1)}K`;
  }
  return remaining.toFixed(2);
};

// Format price per million tokens
export const formatPrice = (price?: number): string => {
  if (price === undefined || price === 0) {
    return 'Free';
  }
  if (price < 0.01) {
    return `$${price.toFixed(4)}`;
  }
  if (price < 1) {
    return `$${price.toFixed(2)}`;
  }
  return `$${price.toFixed(1)}`;
};

// Format modality for display
export const formatModality = (modality: string): string => {
  return modality.charAt(0).toUpperCase() + modality.slice(1);
};
