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

import { Type, Image, Mic } from 'lucide-react';
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

// Cloud environment: 5 providers
export const CLOUD_PROVIDERS: ProviderTab[] = [
  { id: 'openai', displayName: 'OpenAI', logo: OpenAIIcon },
  { id: 'google', displayName: 'Gemini', logo: GeminiIcon },
  { id: 'anthropic', displayName: 'Claude', logo: ClaudeIcon },
  { id: 'x-ai', displayName: 'Grok', logo: GrokIcon },
  { id: 'deepseek', displayName: 'DeepSeek', logo: DeepseekIcon },
];

// Self-hosted environment: 7 providers
export const SELF_HOSTED_PROVIDERS: ProviderTab[] = [
  { id: 'openai', displayName: 'OpenAI', logo: OpenAIIcon },
  { id: 'google', displayName: 'Gemini', logo: GeminiIcon },
  { id: 'anthropic', displayName: 'Claude', logo: ClaudeIcon },
  { id: 'x-ai', displayName: 'Grok', logo: GrokIcon },
  { id: 'deepseek', displayName: 'DeepSeek', logo: DeepseekIcon },
  { id: 'amazon', displayName: 'Amazon', logo: AmazonIcon },
  { id: 'qwen', displayName: 'Qwen', logo: QwenIcon },
];

// Extract provider ID from modelId (e.g., "openai/gpt-4o" -> "openai")
export const getProviderIdFromModelId = (modelId: string): string => {
  return modelId.split('/')[0] || '';
};

// Filter models by provider ID
export const filterModelsByProvider = (
  models: AIModelSchema[],
  providerId: string
): AIModelSchema[] => {
  return models.filter((model) => getProviderIdFromModelId(model.modelId) === providerId);
};

export const getModalityIcon = (
  modality: ModalitySchema
): React.FunctionComponent<React.SVGProps<SVGSVGElement>> => {
  switch (modality) {
    case 'text':
      return Type;
    case 'image':
      return Image;
    case 'audio':
      return Mic;
    // case 'video':
    //   return Video;
    // case 'file':
    //   return File;
    default:
      return Type;
  }
};

export const formatTokenCount = (count: number): string => {
  if (count >= 1000000) {
    return `${(count / 1000000).toFixed(1)}M`;
  } else if (count >= 1000) {
    return `${(count / 1000).toFixed(1)}K`;
  }
  return count.toString();
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
