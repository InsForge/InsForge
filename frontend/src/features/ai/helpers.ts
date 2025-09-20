import { AIConfigurationSchema } from '@insforge/shared-schemas';
import { authService } from '@/features/auth/services/auth.service';
import { Type, Image, Mic, Video } from 'lucide-react';
import GrokIcon from '@/assets/icons/grok.svg?react';
import GeminiIcon from '@/assets/icons/gemini.svg?react';
import ClaudeIcon from '@/assets/icons/claude_code_logo.svg?react';
import OpenAIIcon from '@/assets/icons/openai.svg?react';

export const getModalityIcon = (modality: string) => {
  switch (modality) {
    case 'text':
      return Type;
    case 'image':
      return Image;
    case 'audio':
      return Mic;
    case 'video':
      return Video;
    default:
      return Type; // Default fallback icon
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
    xai: 'xAI',
    huggingface: 'HuggingFace',
  };

  return (
    providerMap[providerId.toLowerCase()] ||
    providerId.charAt(0).toUpperCase() + providerId.slice(1)
  );
};

export const getProviderLogo = (providerId: string) => {
  const logoMap: Record<string, React.FunctionComponent<React.SVGProps<SVGSVGElement>>> = {
    anthropic: ClaudeIcon,
    openai: OpenAIIcon,
    google: GeminiIcon,
    xai: GrokIcon,
  };
  return logoMap[providerId] || providerId.charAt(0).toUpperCase();
};

// Calculate price level based on pricing data
export const calculatePriceLevel = (
  pricing: any
): { level: 'FREE' | '$' | '$$' | '$$$'; color: string } => {
  if (!pricing) return { level: 'FREE', color: 'text-green-400' };

  // Check if it's free
  if (pricing.prompt === '0' && pricing.completion === '0') {
    return { level: 'FREE', color: 'text-green-400' };
  }

  // Calculate average cost per 1M tokens (prompt + completion)
  // Convert from per-token to per-1M-tokens
  const promptCostPerToken = parseFloat(pricing.prompt) || 0;
  const completionCostPerToken = parseFloat(pricing.completion) || 0;
  const promptCostPer1M = promptCostPerToken * 1000000;
  const completionCostPer1M = completionCostPerToken * 1000000;
  const avgCostPer1M = (promptCostPer1M + completionCostPer1M) / 2;

  // Adjusted thresholds based on actual pricing data and user feedback
  if (avgCostPer1M <= 3) return { level: '$', color: 'text-green-400' }; // ≤$3/1M tokens (Haiku, Gemini Flash, etc.)
  if (avgCostPer1M <= 15) return { level: '$$', color: 'text-amber-400' }; // ≤$15/1M tokens (GPT-4o, Claude Sonnet, etc.)
  return { level: '$$$', color: 'text-red-400' }; // >$15/1M tokens (Claude Opus, etc.)
};

export const generateAIIntegrationPrompt = async (
  config: AIConfigurationSchema
): Promise<string> => {
  const baseUrl = window.location.origin;
  const { accessToken: anonKey } = await authService.generateAnonToken();

  // Text modality - Chat endpoint only
  if (config.modality === 'text') {
    return `# InsForge AI SDK - Chat Integration

## Setup

\`\`\`bash
npm install @insforge/sdk
\`\`\`

\`\`\`javascript
import { createClient } from '@insforge/sdk';

const client = createClient({ 
  baseUrl: '${baseUrl}',
  anonKey: '${anonKey}'
});
\`\`\`

## Chat Completion (OpenAI-Compatible)

\`\`\`javascript
// Simple chat completion - OpenAI format
const completion = await client.ai.chat.completions.create({
  model: "${config.modelId}",
  messages: [
    { role: "user", content: "Hello, how are you?" }
  ]
});
// Access response - OpenAI format
console.log(completion.choices[0].message.content);  // AI response text
console.log(completion.usage.total_tokens);          // Token usage

// With conversation history and parameters
const completion = await client.ai.chat.completions.create({
  model: "${config.modelId}",
  messages: [
    { role: "system", content: "You are a helpful assistant" },
    { role: "user", content: "What is TypeScript?" },
    { role: "assistant", content: "TypeScript is a typed superset of JavaScript..." },
    { role: "user", content: "Can you give me an example?" }
  ],
});
\`\`\`
`;
  }

  // Image modality - Image generation endpoint only
  if (config.modality === 'image') {
    return `# InsForge AI SDK - Image + Text Generation
    
This model can generate images AND provide text responses 

## Setup

\`\`\`bash
npm install @insforge/sdk
\`\`\`

\`\`\`javascript
import { createClient } from '@insforge/sdk';

const client = createClient({ 
  baseUrl: '${baseUrl}',
  anonKey: '${anonKey}'
});
\`\`\`

## Image + Text Generation

\`\`\`javascript
// Generate images and text
const response = await client.ai.images.generate({
  model: "${config.modelId}",
  prompt: "A serene mountain landscape at sunset, oil painting style",
  images: [           // Optional: input images for image-to-image models
    { url: 'https://example.com/reference.jpg' }
  ]
});

// Access response - OpenAI format
console.log(response.data[0].b64_json);  // Base64 encoded image string (OpenAI format)
console.log(response.data[0].content);   // AI's text response about the image or prompt
\`\`\`
`;
  }
  return '';
};
