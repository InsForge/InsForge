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

// File content schema for PDFs and other documents (OpenRouter format)
export const fileContentSchema = z.object({
  type: z.literal('file'),
  file: z.object({
    // Filename with extension (e.g., "document.pdf")
    filename: z.string(),
    // File data can be:
    // - Public URL: "https://example.com/document.pdf"
    // - Base64 data URL: "data:application/pdf;base64,..."
    // eslint-disable-next-line @typescript-eslint/naming-convention
    file_data: z.string(),
  }),
});

export const contentSchema = z.union([
  textContentSchema,
  imageContentSchema,
  audioContentSchema,
  fileContentSchema,
]);

// Tool function definition (OpenAI-compatible)
export const toolFunctionSchema = z.object({
  name: z.string(),
  description: z.string().optional(),
  parameters: z.record(z.unknown()).optional(),
});

// Tool definition
export const toolSchema = z.object({
  type: z.literal('function'),
  function: toolFunctionSchema,
});

// Tool choice - controls whether/which tool is called
export const toolChoiceSchema = z.union([
  z.enum(['auto', 'none', 'required']),
  z.object({
    type: z.literal('function'),
    function: z.object({ name: z.string() }),
  }),
]);

// Tool call from assistant response
export const toolCallSchema = z.object({
  id: z.string(),
  type: z.literal('function'),
  function: z.object({
    name: z.string(),
    arguments: z.string(),
  }),
});

// Chat message supports both OpenAI format and legacy format for backward compatibility
export const chatMessageSchema = z.object({
  role: z.enum(['user', 'assistant', 'system', 'tool']),
  // New format: content can be string or array of content parts (OpenAI-compatible)
  content: z.union([z.string(), z.array(contentSchema)]).nullable(),
  // Legacy format: separate images field (deprecated but supported for backward compatibility)
  images: z.array(z.object({ url: z.string() })).optional(),
  // Tool calls made by the assistant
  // eslint-disable-next-line @typescript-eslint/naming-convention
  tool_calls: z.array(toolCallSchema).optional(),
  // Tool call ID for tool response messages
  // eslint-disable-next-line @typescript-eslint/naming-convention
  tool_call_id: z.string().optional(),
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

// File Parser Plugin configuration for OpenRouter PDF processing
export const fileParserPluginSchema = z.object({
  enabled: z.boolean(),
  pdf: z
    .object({
      // PDF processing engine:
      // - "pdf-text": Best for well-structured PDFs with clear text content (Free)
      // - "mistral-ocr": Best for scanned documents or PDFs with images ($2 per 1,000 pages)
      // - "native": Only available for models that support file input natively (charged as input tokens)
      // If not specified, defaults to native if available, otherwise mistral-ocr
      engine: z.enum(['pdf-text', 'mistral-ocr', 'native']).optional(),
    })
    .optional(),
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
  // File Parser: Configure PDF processing for file content in messages
  // When files are included in messages, this controls how PDFs are parsed
  fileParser: fileParserPluginSchema.optional(),
  // Thinking/Reasoning mode: Enable extended reasoning capabilities
  // Appends ":thinking" to the model ID for chain-of-thought reasoning
  thinking: z.boolean().optional(),
  // Tool calling: Define functions the AI can call
  tools: z.array(toolSchema).optional(),
  // Tool choice: Control whether/which tool is called ('auto', 'none', 'required', or specific function)
  // eslint-disable-next-line @typescript-eslint/naming-convention
  tool_choice: toolChoiceSchema.optional(),
  // Parallel tool calls: Allow the model to call multiple tools in parallel
  // eslint-disable-next-line @typescript-eslint/naming-convention
  parallel_tool_calls: z.boolean().optional(),
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

// File annotation from PDF parsing results
// Can be passed back in subsequent requests to skip re-parsing costs
export const fileAnnotationSchema = z.object({
  type: z.literal('file'),
  file: z.object({
    filename: z.string(),
    // Parsed content from the PDF (used for caching)
    parsedContent: z.string().optional(),
    // Additional metadata from the parser
    metadata: z.record(z.unknown()).optional(),
  }),
});

// Combined annotation schema for all annotation types
export const annotationSchema = z.union([urlCitationAnnotationSchema, fileAnnotationSchema]);

export const chatCompletionResponseSchema = z.object({
  text: z.string(),
  // Tool calls from the assistant (present when the model invokes tools)
  // eslint-disable-next-line @typescript-eslint/naming-convention
  tool_calls: z.array(toolCallSchema).optional(),
  // Annotations from web search or file parsing (can be URL citations or file annotations)
  annotations: z.array(annotationSchema).optional(),
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

// ============= Embeddings Schemas =============

export const embeddingsRequestSchema = z.object({
  model: z.string(),
  input: z.union([z.string(), z.array(z.string())]),
  // eslint-disable-next-line @typescript-eslint/naming-convention
  encoding_format: z.enum(['float', 'base64']).optional(),
  dimensions: z.number().int().min(0).optional(),
});

export const embeddingObjectSchema = z.object({
  object: z.literal('embedding'),
  // Embedding can be number[] (float format) or string (base64 format)
  embedding: z.union([z.array(z.number()), z.string()]),
  index: z.number(),
});

export const embeddingsResponseSchema = z.object({
  object: z.literal('list'),
  data: z.array(embeddingObjectSchema),
  metadata: z
    .object({
      model: z.string(),
      usage: z
        .object({
          promptTokens: z.number().optional(),
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
  inputPrice: z.number().min(0).optional(), // Price per million tokens in USD
  outputPrice: z.number().min(0).optional(), // Price per million tokens in USD
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
export type ToolFunction = z.infer<typeof toolFunctionSchema>;
export type Tool = z.infer<typeof toolSchema>;
export type ToolChoice = z.infer<typeof toolChoiceSchema>;
export type ToolCall = z.infer<typeof toolCallSchema>;
export type TextContentSchema = z.infer<typeof textContentSchema>;
export type ImageContentSchema = z.infer<typeof imageContentSchema>;
export type AudioContentSchema = z.infer<typeof audioContentSchema>;
export type FileContentSchema = z.infer<typeof fileContentSchema>;
export type ContentSchema = z.infer<typeof contentSchema>;
export type ChatMessageSchema = z.infer<typeof chatMessageSchema>;
export type WebSearchPlugin = z.infer<typeof webSearchPluginSchema>;
export type FileParserPlugin = z.infer<typeof fileParserPluginSchema>;
export type UrlCitationAnnotation = z.infer<typeof urlCitationAnnotationSchema>;
export type FileAnnotation = z.infer<typeof fileAnnotationSchema>;
export type Annotation = z.infer<typeof annotationSchema>;
export type ChatCompletionRequest = z.infer<typeof chatCompletionRequestSchema>;
export type ChatCompletionResponse = z.infer<typeof chatCompletionResponseSchema>;
export type ImageGenerationRequest = z.infer<typeof imageGenerationRequestSchema>;
export type ImageGenerationResponse = z.infer<typeof imageGenerationResponseSchema>;
export type EmbeddingsRequest = z.infer<typeof embeddingsRequestSchema>;
export type EmbeddingObject = z.infer<typeof embeddingObjectSchema>;
export type EmbeddingsResponse = z.infer<typeof embeddingsResponseSchema>;
export type AIModelSchema = z.infer<typeof aiModelSchema>;
export type CreateAIConfigurationRequest = z.infer<typeof createAIConfigurationRequestSchema>;
export type UpdateAIConfigurationRequest = z.infer<typeof updateAIConfigurationRequestSchema>;
export type ListAIUsageResponse = z.infer<typeof listAIUsageResponseSchema>;
export type GetAIUsageRequest = z.infer<typeof getAIUsageRequestSchema>;
export type GetAIUsageSummaryRequest = z.infer<typeof getAIUsageSummaryRequestSchema>;
