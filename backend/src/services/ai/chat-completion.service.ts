import OpenAI from 'openai';
import { AIUsageService } from './ai-usage.service.js';
import { AIConfigService } from './ai-config.service.js';
import { OpenRouterProvider } from '@/providers/ai/openrouter.provider.js';
import type {
  AIConfigurationSchema,
  ChatCompletionResponse,
  ChatMessageSchema,
  ToolCall,
  UrlCitationAnnotation,
} from '@insforge/shared-schemas';
import logger from '@/utils/logger.js';
import { ChatCompletionOptions } from '@/types/ai.js';

// OpenRouter plugin type for web search
interface OpenRouterWebPlugin {
  id: 'web';
  engine?: 'native' | 'exa';
  max_results?: number;
  search_prompt?: string;
}

// OpenRouter plugin type for file parsing (PDF processing)
interface OpenRouterFileParserPlugin {
  id: 'file-parser';
  pdf?: {
    engine?: 'pdf-text' | 'mistral-ocr' | 'native';
  };
}

// Union type for all OpenRouter plugins
type OpenRouterPlugin = OpenRouterWebPlugin | OpenRouterFileParserPlugin;

// Extended request type with OpenRouter-specific fields
interface OpenRouterChatCompletionRequest
  extends OpenAI.Chat.ChatCompletionCreateParamsNonStreaming {
  plugins?: OpenRouterPlugin[];
}

interface OpenRouterChatCompletionStreamingRequest
  extends OpenAI.Chat.ChatCompletionCreateParamsStreaming {
  plugins?: OpenRouterPlugin[];
}

// OpenRouter annotation format from API response
interface OpenRouterUrlCitation {
  type: 'url_citation';
  url_citation: {
    url: string;
    title?: string;
    content?: string;
    start_index?: number;
    end_index?: number;
  };
}

// Message structure that may contain annotations (from OpenRouter response)
interface MessageWithAnnotations {
  content?: string | null;
  annotations?: OpenRouterUrlCitation[];
}

export class ChatCompletionService {
  private static instance: ChatCompletionService;
  private aiUsageService = AIUsageService.getInstance();
  private aiConfigService = AIConfigService.getInstance();
  private openRouterProvider = OpenRouterProvider.getInstance();

  private constructor() {}

  public static getInstance(): ChatCompletionService {
    if (!ChatCompletionService.instance) {
      ChatCompletionService.instance = new ChatCompletionService();
    }
    return ChatCompletionService.instance;
  }

  /**
   * Format messages for OpenAI API with multimodal support
   */
  private formatMessages(
    messages: ChatMessageSchema[],
    systemPrompt?: string
  ): OpenAI.Chat.ChatCompletionMessageParam[] {
    const formattedMessages: OpenAI.Chat.ChatCompletionMessageParam[] = [];

    // Add system message if provided
    if (systemPrompt) {
      formattedMessages.push({ role: 'system', content: systemPrompt });
    }

    // Format conversation messages
    for (const msg of messages) {
      // Handle tool response messages
      if (msg.role === 'tool') {
        if (!msg.tool_call_id) {
          throw new Error('Tool message is missing required tool_call_id');
        }
        formattedMessages.push({
          role: 'tool',
          content: typeof msg.content === 'string' ? msg.content : JSON.stringify(msg.content),
          tool_call_id: msg.tool_call_id,
        } as OpenAI.Chat.ChatCompletionToolMessageParam);
        continue;
      }

      // Handle assistant messages with tool_calls
      if (msg.role === 'assistant' && msg.tool_calls && msg.tool_calls.length > 0) {
        formattedMessages.push({
          role: 'assistant',
          content: typeof msg.content === 'string' ? msg.content : (msg.content ?? null),
          tool_calls: msg.tool_calls,
        } as OpenAI.Chat.ChatCompletionAssistantMessageParam);
        continue;
      }

      // Check if message has images (legacy format), new format image is within the content array
      if (msg.images && msg.images.length && typeof msg.content === 'string') {
        // Build multimodal content array
        const content = [
          { type: 'text', text: msg.content },
          ...msg.images.map((image) => ({
            type: 'image_url',
            image_url: { url: image.url },
          })),
        ];

        formattedMessages.push({
          role: msg.role as 'system' | 'user' | 'assistant',
          content,
        } as OpenAI.Chat.ChatCompletionMessageParam);
      } else {
        // Simple text message or new format (content array)
        formattedMessages.push({
          role: msg.role as 'system' | 'user' | 'assistant',
          content: msg.content,
        } as OpenAI.Chat.ChatCompletionMessageParam);
      }
    }

    return formattedMessages;
  }

  /**
   * Validate model and get config
   * For models with variants (e.g., model:thinking), first checks the full model ID
   */
  async validateAndGetConfig(
    modelId: string,
    thinking?: boolean
  ): Promise<AIConfigurationSchema | null> {
    // Build the actual model ID with optional :thinking suffix
    const actualModelId = this.buildModelId(modelId, thinking);
    const aiConfig = await this.aiConfigService.findByModelId(actualModelId);
    if (!aiConfig) {
      throw new Error(
        `Model ${actualModelId} is not enabled. Please contact your administrator to enable this model.`
      );
    }
    return aiConfig;
  }

  /**
   * Build the model ID with optional :thinking suffix
   */
  private buildModelId(model: string, thinking?: boolean): string {
    if (thinking && model.endsWith(':thinking') === false) {
      return `${model}:thinking`;
    }
    return model;
  }

  /**
   * Build web search plugin configuration
   */
  private buildWebSearchPlugin(
    webSearch?: ChatCompletionOptions['webSearch']
  ): OpenRouterWebPlugin | undefined {
    if (!webSearch?.enabled) {
      return undefined;
    }

    const plugin: OpenRouterWebPlugin = { id: 'web' };

    if (webSearch.engine) {
      plugin.engine = webSearch.engine;
    }
    if (webSearch.maxResults) {
      plugin.max_results = webSearch.maxResults;
    }
    if (webSearch.searchPrompt) {
      plugin.search_prompt = webSearch.searchPrompt;
    }

    return plugin;
  }

  /**
   * Build file parser plugin configuration for PDF processing
   */
  private buildFileParserPlugin(
    fileParser?: ChatCompletionOptions['fileParser']
  ): OpenRouterFileParserPlugin | undefined {
    if (!fileParser?.enabled) {
      return undefined;
    }

    const plugin: OpenRouterFileParserPlugin = { id: 'file-parser' };

    if (fileParser.pdf?.engine) {
      plugin.pdf = { engine: fileParser.pdf.engine };
    }

    return plugin;
  }

  /**
   * Build all plugins array from options
   */
  private buildPlugins(options: ChatCompletionOptions): OpenRouterPlugin[] | undefined {
    const plugins: OpenRouterPlugin[] = [];

    const webSearchPlugin = this.buildWebSearchPlugin(options.webSearch);
    if (webSearchPlugin) {
      plugins.push(webSearchPlugin);
    }

    const fileParserPlugin = this.buildFileParserPlugin(options.fileParser);
    if (fileParserPlugin) {
      plugins.push(fileParserPlugin);
    }

    return plugins.length > 0 ? plugins : undefined;
  }

  /**
   * Parse annotations from OpenRouter response to our format
   */
  private parseAnnotations(
    message: MessageWithAnnotations | undefined | null
  ): UrlCitationAnnotation[] | undefined {
    if (!message?.annotations || !Array.isArray(message.annotations)) {
      return undefined;
    }

    const annotations: UrlCitationAnnotation[] = [];

    for (const annotation of message.annotations) {
      if (annotation.type === 'url_citation' && annotation.url_citation) {
        annotations.push({
          type: 'url_citation',
          urlCitation: {
            url: annotation.url_citation.url,
            title: annotation.url_citation.title,
            content: annotation.url_citation.content,
            startIndex: annotation.url_citation.start_index,
            endIndex: annotation.url_citation.end_index,
          },
        });
      }
    }

    return annotations.length > 0 ? annotations : undefined;
  }

  /**
   * Send a chat message to the specified model
   * @param messages - Array of messages for conversation
   * @param options - Chat options including model, temperature, webSearch, thinking, etc.
   */
  async chat(
    messages: ChatMessageSchema[],
    options: ChatCompletionOptions
  ): Promise<ChatCompletionResponse> {
    try {
      // Validate model and get config (pass thinking option for variant checking)
      const aiConfig = await this.validateAndGetConfig(options.model, options.thinking);

      // Build model ID with optional :thinking suffix
      const modelId = this.buildModelId(options.model, options.thinking);

      // Apply system prompt from config if available
      const formattedMessages = this.formatMessages(messages, aiConfig?.systemPrompt);

      // Build request with optional plugins (web search, file parser)
      const request: OpenRouterChatCompletionRequest = {
        model: modelId,
        messages: formattedMessages,
        temperature: options.temperature ?? 0.7,
        max_tokens: options.maxTokens ?? 4096,
        top_p: options.topP,
        stream: false,
        plugins: this.buildPlugins(options),
        tools: options.tools,
        tool_choice: options.tool_choice,
        parallel_tool_calls: options.parallel_tool_calls,
      };

      // Send request with automatic renewal and retry logic
      const response = await this.openRouterProvider.sendRequest((client) =>
        client.chat.completions.create(
          request as OpenAI.Chat.ChatCompletionCreateParamsNonStreaming
        )
      );

      // Extract token usage if available
      const tokenUsage = response.usage
        ? {
            promptTokens: response.usage.prompt_tokens,
            completionTokens: response.usage.completion_tokens,
            totalTokens: response.usage.total_tokens,
          }
        : undefined;

      // Track usage if config is available
      if (aiConfig?.id && tokenUsage) {
        await this.aiUsageService.trackChatUsage(
          aiConfig.id,
          tokenUsage.promptTokens,
          tokenUsage.completionTokens,
          modelId // pass the actual model ID used
        );
      }

      // Parse annotations from response (for web search results)
      const annotations = this.parseAnnotations(
        response.choices[0]?.message as MessageWithAnnotations | undefined
      );

      // Extract tool_calls from response
      const rawToolCalls = response.choices[0]?.message?.tool_calls;
      const toolCalls: ToolCall[] | undefined =
        rawToolCalls && rawToolCalls.length > 0
          ? rawToolCalls
              .filter(
                (tc): tc is OpenAI.Chat.ChatCompletionMessageToolCall & { type: 'function' } =>
                  tc.type === 'function'
              )
              .map((tc) => ({
                id: tc.id,
                type: 'function' as const,
                function: {
                  name: tc.function.name,
                  arguments: tc.function.arguments,
                },
              }))
          : undefined;

      return {
        text: response.choices[0]?.message?.content || '',
        tool_calls: toolCalls,
        annotations,
        metadata: {
          model: modelId,
          usage: tokenUsage,
        },
      };
    } catch (error) {
      logger.error('Chat error', { error });
      throw new Error(
        `Failed to get response: ${error instanceof Error ? error.message : String(error)}`
      );
    }
  }

  /**
   * Stream a chat response
   * @param messages - Array of messages for conversation
   * @param options - Chat options including model, temperature, webSearch, thinking, etc.
   */
  async *streamChat(
    messages: ChatMessageSchema[],
    options: ChatCompletionOptions
  ): AsyncGenerator<{
    chunk?: string;
    tokenUsage?: { promptTokens?: number; completionTokens?: number; totalTokens?: number };
    annotations?: UrlCitationAnnotation[];
    tool_calls?: ToolCall[];
  }> {
    try {
      // Validate model and get config (pass thinking option for variant checking)
      const aiConfig = await this.validateAndGetConfig(options.model, options.thinking);

      // Build model ID with optional :thinking suffix
      const modelId = this.buildModelId(options.model, options.thinking);

      // Apply system prompt from config if available
      const formattedMessages = this.formatMessages(messages, aiConfig?.systemPrompt);

      // Build request with optional plugins (web search, file parser)
      const request: OpenRouterChatCompletionStreamingRequest = {
        model: modelId,
        messages: formattedMessages,
        temperature: options.temperature ?? 0.7,
        max_tokens: options.maxTokens ?? 4096,
        top_p: options.topP,
        stream: true,
        plugins: this.buildPlugins(options),
        tools: options.tools,
        tool_choice: options.tool_choice,
        parallel_tool_calls: options.parallel_tool_calls,
      };

      // Send request with automatic renewal and retry logic
      const stream = await this.openRouterProvider.sendRequest((client) =>
        client.chat.completions.create(request as OpenAI.Chat.ChatCompletionCreateParamsStreaming)
      );

      const tokenUsage = {
        promptTokens: 0,
        completionTokens: 0,
        totalTokens: 0,
      };

      // Collect annotations from streaming response
      let collectedAnnotations: UrlCitationAnnotation[] | undefined;

      // Collect tool call deltas across chunks
      const toolCallMap = new Map<number, { id: string; name: string; arguments: string }>();

      for await (const chunk of stream) {
        const content = chunk.choices[0]?.delta?.content;
        if (content) {
          yield { chunk: content };
        }

        // Accumulate tool_call deltas from streaming chunks
        const deltaToolCalls = chunk.choices[0]?.delta?.tool_calls;
        if (deltaToolCalls) {
          for (const delta of deltaToolCalls) {
            const existing = toolCallMap.get(delta.index);
            if (existing) {
              // Append to existing tool call
              if (delta.function?.arguments) {
                existing.arguments += delta.function.arguments;
              }
            } else {
              // Start a new tool call entry
              toolCallMap.set(delta.index, {
                id: delta.id || '',
                name: delta.function?.name || '',
                arguments: delta.function?.arguments || '',
              });
            }
          }
        }

        // Check for annotations in the chunk (web search results)
        const chunkAnnotations = this.parseAnnotations(
          chunk.choices[0]?.delta as MessageWithAnnotations | undefined
        );
        if (chunkAnnotations) {
          collectedAnnotations = collectedAnnotations || [];
          collectedAnnotations.push(...chunkAnnotations);
        }

        // Check if this chunk contains usage data
        if (chunk.usage) {
          // Accumulate tokens instead of replacing
          tokenUsage.promptTokens += chunk.usage.prompt_tokens || 0;
          tokenUsage.completionTokens += chunk.usage.completion_tokens || 0;
          tokenUsage.totalTokens += chunk.usage.total_tokens || 0;

          // Yield the accumulated usage
          yield { tokenUsage: { ...tokenUsage } };
        }
      }

      // Yield collected tool calls at the end if present
      if (toolCallMap.size > 0) {
        const toolCalls: ToolCall[] = Array.from(toolCallMap.entries())
          .sort(([a], [b]) => a - b)
          .map(([, tc]) => ({
            id: tc.id,
            type: 'function' as const,
            function: {
              name: tc.name,
              arguments: tc.arguments,
            },
          }));
        yield { tool_calls: toolCalls };
      }

      // Yield annotations at the end if present
      if (collectedAnnotations && collectedAnnotations.length > 0) {
        yield { annotations: collectedAnnotations };
      }

      // Track usage after streaming completes
      if (aiConfig?.id && tokenUsage.totalTokens > 0) {
        await this.aiUsageService.trackChatUsage(
          aiConfig.id,
          tokenUsage.promptTokens,
          tokenUsage.completionTokens,
          modelId // pass the actual model ID used
        );
      }
    } catch (error) {
      logger.error('Streaming error', { error });
      throw new Error(
        `Failed to stream response: ${error instanceof Error ? error.message : String(error)}`
      );
    }
  }
}
