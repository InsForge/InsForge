import { z } from 'zod';
import { aiConfigurationSchema, aiUsageRecordSchema, modalitySchema } from './ai.schema';

// ============= Chat Completion Schemas =============

// OpenAI-compatible content schemas
export const textContentSchema = z.object({
  type: z.literal('text'),
  text: z.string(),
});

export const imageContentSchema = z.object({
  type: z.literal('image_url'),
  // eslint-disable-next-line @typescript-eslint/naming-convention
  image_url: z.object({
    // URL can be either a public URL or base64-encoded data URI
    // Examples:
    // - Public URL: "https://example.com/image.jpg"
    // - Base64: "data:image/jpeg;base64,/9j/4AAQ..."
    url: z.string(),
    detail: z.enum(['auto', 'low', 'high']).optional(),
  }),
});

export const audioContentSchema = z.object({
  type: z.literal('input_audio'),
  // eslint-disable-next-line @typescript-eslint/naming-convention
  input_audio: z.object({
    // Base64-encoded audio data (direct URLs not supported for audio)
    data: z.string(),
    format: z.enum(['wav', 'mp3', 'aiff', 'aac', 'ogg', 'flac', 'm4a']),
  }),
});

export const contentSchema = z.union([textContentSchema, imageContentSchema, audioContentSchema]);

// Chat message supports both OpenAI format and legacy format for backward compatibility
export const chatMessageSchema = z.object({
  role: z.enum(['user', 'assistant', 'system']),
  // New format: content can be string or array of content parts (OpenAI-compatible)
  content: z.union([z.string(), z.array(contentSchema)]),
  // Legacy format: separate images field (deprecated but supported for backward compatibility)
  images: z.array(z.object({ url: z.string() })).optional(),
});

// Web Search Plugin configuration for OpenRouter
export const webSearchPluginSchema = z.object({
  enabled: z.boolean(),
  // Engine selection:
  // - "native": Always use provider's built-in web search (OpenAI, Anthropic, Perplexity, xAI)
  // - "exa": Use Exa's search API
  // - undefined: Auto-select (native if available, otherwise Exa)
  engine: z.enum(['native', 'exa']).optional(),
  // Maximum number of search results (1-10, default: 5)
  maxResults: z.number().min(1).max(10).optional(),
  // Custom prompt for attaching search results to the message
  searchPrompt: z.string().optional(),
});

export const chatCompletionRequestSchema = z.object({
  model: z.string(),
  messages: z.array(chatMessageSchema),
  temperature: z.number().min(0).max(2).optional(),
  maxTokens: z.number().positive().optional(),
  topP: z.number().min(0).max(1).optional(),
  stream: z.boolean().optional(),
  // Web Search: Incorporate relevant web search results into the response
  // Results are returned in the annotations field
  webSearch: webSearchPluginSchema.optional(),
  // Thinking/Reasoning mode: Enable extended reasoning capabilities
  // Appends ":thinking" to the model ID for chain-of-thought reasoning
  thinking: z.boolean().optional(),
});

// URL citation annotation from web search results
export const urlCitationAnnotationSchema = z.object({
  type: z.literal('url_citation'),
  urlCitation: z.object({
    url: z.string(),
    title: z.string().optional(),
    content: z.string().optional(),
    // Character indices in the response text where this citation applies
    startIndex: z.number().optional(),
    endIndex: z.number().optional(),
  }),
});

export const chatCompletionResponseSchema = z.object({
  text: z.string(),
  // Web search URL citations (present when webSearch is enabled)
  annotations: z.array(urlCitationAnnotationSchema).optional(),
  metadata: z
    .object({
      model: z.string(),
      usage: z
        .object({
          promptTokens: z.number().optional(),
          completionTokens: z.number().optional(),
          totalTokens: z.number().optional(),
        })
        .optional(),
    })
    .optional(),
});

// ============= Image Generation Schemas =============

export const imageGenerationRequestSchema = z.object({
  model: z.string(),
  prompt: z.string(),
  images: z
    .array(
      z.object({
        url: z.string(),
      })
    )
    .optional(),
});

export const imageGenerationResponseSchema = z.object({
  text: z.string().optional(),
  images: z.array(
    z.object({
      type: z.literal('imageUrl'),
      imageUrl: z.string(),
    })
  ),
  metadata: z
    .object({
      model: z.string(),
      usage: z
        .object({
          promptTokens: z.number().optional(),
          completionTokens: z.number().optional(),
          totalTokens: z.number().optional(),
        })
        .optional(),
    })
    .optional(),
});

export const aiModelSchema = z.object({
  id: z.string(),
  inputModality: z.array(modalitySchema).min(1),
  outputModality: z.array(modalitySchema).min(1),
  provider: z.string(),
  modelId: z.string(),
  priceLevel: z.number().min(0).max(3).optional(),
});

export const createAIConfigurationRequestSchema = aiConfigurationSchema.omit({
  id: true,
});

export const updateAIConfigurationRequestSchema = z.object({
  systemPrompt: z.string().nullable(),
});

export const listAIUsageResponseSchema = z.object({
  records: z.array(aiUsageRecordSchema),
  total: z.number(),
});

export const getAIUsageRequestSchema = z.object({
  startDate: z.string().datetime().optional(),
  endDate: z.string().datetime().optional(),
  limit: z.string().regex(/^\d+$/).default('50'),
  offset: z.string().regex(/^\d+$/).default('0'),
});

export const getAIUsageSummaryRequestSchema = z.object({
  configId: z.string().uuid().optional(),
  startDate: z.string().datetime().optional(),
  endDate: z.string().datetime().optional(),
});

// Export types
export type TextContentSchema = z.infer<typeof textContentSchema>;
export type ImageContentSchema = z.infer<typeof imageContentSchema>;
export type AudioContentSchema = z.infer<typeof audioContentSchema>;
export type ContentSchema = z.infer<typeof contentSchema>;
export type ChatMessageSchema = z.infer<typeof chatMessageSchema>;
export type WebSearchPlugin = z.infer<typeof webSearchPluginSchema>;
export type UrlCitationAnnotation = z.infer<typeof urlCitationAnnotationSchema>;
export type ChatCompletionRequest = z.infer<typeof chatCompletionRequestSchema>;
export type ChatCompletionResponse = z.infer<typeof chatCompletionResponseSchema>;
export type ImageGenerationRequest = z.infer<typeof imageGenerationRequestSchema>;
export type ImageGenerationResponse = z.infer<typeof imageGenerationResponseSchema>;
export type AIModelSchema = z.infer<typeof aiModelSchema>;
export type CreateAIConfigurationRequest = z.infer<typeof createAIConfigurationRequestSchema>;
export type UpdateAIConfigurationRequest = z.infer<typeof updateAIConfigurationRequestSchema>;
export type ListAIUsageResponse = z.infer<typeof listAIUsageResponseSchema>;
export type GetAIUsageRequest = z.infer<typeof getAIUsageRequestSchema>;
export type GetAIUsageSummaryRequest = z.infer<typeof getAIUsageSummaryRequestSchema>;
