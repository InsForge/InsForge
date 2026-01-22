import { OpenRouterProvider } from '@/providers/ai/openrouter.provider.js';
import type { EmbeddingsRequest, EmbeddingsResponse } from '@insforge/shared-schemas';
import logger from '@/utils/logger.js';
import { AIConfigService } from './ai-config.service.js';
import { AIUsageService } from './ai-usage.service.js';

export class EmbeddingService {
  private static instance: EmbeddingService;
  private openRouterProvider = OpenRouterProvider.getInstance();
  private aiConfigService = AIConfigService.getInstance();
  private aiUsageService = AIUsageService.getInstance();

  private constructor() {}

  public static getInstance(): EmbeddingService {
    if (!EmbeddingService.instance) {
      EmbeddingService.instance = new EmbeddingService();
    }
    return EmbeddingService.instance;
  }

  /**
   * Generate embeddings for the given input using OpenRouter API
   * Uses sendRequest for automatic renewal and retry logic
   * @param options - Embeddings request options including model, input, and encoding_format
   * @returns Embeddings response with vector data and metadata
   */
  async createEmbeddings(options: EmbeddingsRequest): Promise<EmbeddingsResponse> {
    try {
      // Send request with automatic renewal and retry logic (same pattern as chat-completion)
      const aiConfig = await this.aiConfigService.findByModelId(options.model);
      const response = await this.openRouterProvider.sendRequest((client) =>
        client.embeddings.create({
          model: options.model,
          input: options.input,
          encoding_format: options.encoding_format || 'float',
          dimensions: options.dimensions,
        })
      );

      logger.debug('Embeddings generated successfully', {
        model: response.model,
        inputCount: Array.isArray(options.input) ? options.input.length : 1,
        embeddingsCount: response.data.length,
        promptTokens: response.usage?.prompt_tokens,
      });

      // Extract token usage if available
      const tokenUsage = response.usage
        ? {
            promptTokens: response.usage.prompt_tokens,
            totalTokens: response.usage.total_tokens,
          }
        : undefined;

      // Track usage if config is available
      if (aiConfig?.id && tokenUsage) {
        const outputTokens = Math.max(
          0,
          (tokenUsage.totalTokens || 0) - (tokenUsage.promptTokens || 0)
        );
        await this.aiUsageService.trackChatUsage(
          aiConfig.id,
          tokenUsage.promptTokens,
          outputTokens,
          options.model // pass the actual model ID used
        );
      }

      // Transform to our response format with metadata
      return {
        object: 'list',
        data: response.data.map((item) => ({
          object: 'embedding' as const,
          embedding: item.embedding as number[] | string,
          index: item.index,
        })),
        metadata: {
          model: response.model,
          usage: tokenUsage,
        },
      };
    } catch (error) {
      logger.warn('Embedding error', {
        error: error instanceof Error ? error.message : String(error),
        model: options.model,
      });
      throw new Error(
        `Failed to generate embeddings: ${error instanceof Error ? error.message : String(error)}`
      );
    }
  }
}
