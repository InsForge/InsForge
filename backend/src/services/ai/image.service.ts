import OpenAI from 'openai';

import { AIUsageService } from './usage.service';
import { AIConfigService } from './config.service';
import { AIClientService } from '@/providers/ai/openrouter.provider';
import type {
  AIConfigurationSchema,
  ImageGenerationRequest,
  ImageGenerationResponse,
} from '@insforge/shared-schemas';
import logger from '@/utils/logger.js';
import { OpenRouterImageMessage } from '@/types/ai';

export class ImageService {
  private static aiUsageService = new AIUsageService();
  private static aiConfigService = new AIConfigService();
  private static aiClientService = AIClientService.getInstance();

  /**
   * Validate model and get config
   */
  private static async validateAndGetConfig(
    modelId: string
  ): Promise<AIConfigurationSchema | null> {
    const aiConfig = await ImageService.aiConfigService.findByModelId(modelId);
    if (!aiConfig) {
      throw new Error(
        `Model ${modelId} is not enabled. Please contact your administrator to enable this model.`
      );
    }
    return aiConfig;
  }

  /**
   * Generate images using the specified model
   * @param options - Image generation options
   */
  static async generate(options: ImageGenerationRequest): Promise<ImageGenerationResponse> {
    // Validate model and get config
    const aiConfig = await ImageService.validateAndGetConfig(options.model);

    const model = options.model;

    try {
      // Concatenate system prompt with user prompt if it exists
      // This is because OpenRouter image models don't properly handle system messages
      let finalPrompt = options.prompt;
      if (aiConfig?.systemPrompt) {
        finalPrompt = `${aiConfig.systemPrompt}\n\n${options.prompt}`;
      }

      // Build content for the message
      const userContent = options.images?.length
        ? [
            { type: 'text', text: finalPrompt },
            ...options.images.map((image) => ({
              type: 'image_url',
              image_url: { url: image.url },
            })),
          ]
        : finalPrompt;

      // Build the request - OpenRouter extends OpenAI's API with additional fields
      const request = {
        model,
        messages: [
          {
            role: 'user',
            content: userContent,
          },
        ],
        stream: false, // Explicitly disable streaming
        // OpenRouter-specific field for image generation
        modalities: ['text', 'image'],
      };

      // Send request with automatic renewal and retry logic
      const response = (await this.aiClientService.sendRequest((client) =>
        client.chat.completions.create(
          request as OpenAI.Chat.ChatCompletionCreateParamsNonStreaming
        )
      )) as OpenAI.Chat.ChatCompletion;

      // Initialize the result
      const result: ImageGenerationResponse = {
        images: [],
        metadata: {
          model: model,
          usage: response.usage
            ? {
                promptTokens: response.usage.prompt_tokens || 0,
                completionTokens: response.usage.completion_tokens || 0,
                totalTokens: response.usage.total_tokens || 0,
              }
            : undefined,
        },
      };

      // Process the OpenAI-compatible response
      if (response.choices && response.choices.length) {
        for (const choice of response.choices) {
          const message = choice.message;

          // Extract text content if present (for multimodal responses)
          if (message.content) {
            result.text = message.content;
            // Use text as revised prompt if available
          }

          // OpenRouter adds an 'images' field to the assistant message for image generation
          // Cast the message to include the extended OpenRouter fields
          const extendedMessage = message as typeof message & {
            images?: OpenRouterImageMessage[];
          };

          // Check for images in the OpenRouter format
          if (extendedMessage.images && Array.isArray(extendedMessage.images)) {
            for (const image of extendedMessage.images) {
              if (image.type === 'image_url' && image.image_url?.url) {
                result.images.push({
                  type: 'imageUrl',
                  imageUrl: image.image_url?.url,
                });
              }
            }
          }
        }
      }

      // Track usage if config is available
      if (aiConfig?.id) {
        // Pass token usage information if available
        const inputTokens = result.metadata?.usage?.promptTokens;
        const outputTokens = result.metadata?.usage?.completionTokens;

        await ImageService.aiUsageService.trackImageGenerationUsage(
          aiConfig.id,
          result.images.length,
          undefined, // image resolution not available from OpenRouter
          inputTokens,
          outputTokens,
          options.model
        );
      }

      return result;
    } catch (error) {
      logger.error('Image generation error', { error });
      throw new Error(
        `Failed to generate image: ${error instanceof Error ? error.message : String(error)}`
      );
    }
  }
}
