// Additional types that are backend-specific or internal

import { ChatCompletionRequest } from '@insforge/shared-schemas';

export type ChatCompletionOptions = Omit<ChatCompletionRequest, 'stream' | 'messages'>;

export interface OpenRouterImageMessage {
  type: 'image_url';
  image_url: {
    url: string; // Can be a direct URL or data:image base64 URL
  };
}

export interface OpenRouterAudioMessage {
  type: 'input_audio';
  input_audio: {
    data: string; // Base64-encoded audio data
    format: string; // wav, mp3, aiff, aac, ogg, flac, m4a
  };
}

// ============= OpenRouter API Types =============

export interface RawOpenRouterModel {
  id: string;
  name: string;
  created: number;
  description?: string;
  architecture?: {
    input_modalities: string[];
    output_modalities: string[];
    tokenizer: string;
    instruct_type: string;
  };
  topProvider?: {
    is_moderated: boolean;
    context_length: number;
    max_completion_tokens: number;
  };
  pricing: {
    prompt: string;
    completion: string;
    image?: string;
    request?: string;
    web_search?: string;
    internal_reasoning?: string;
    input_cache_read?: string;
    input_cache_write?: string;
  };
  context_length: number;
  max_completion_tokens?: number;
  per_request_limits?: Record<string, unknown>;
  supported_parameters?: string[];
}
