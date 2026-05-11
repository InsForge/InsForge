import OpenAI from 'openai';

import { OpenRouterProvider } from '@/providers/ai/openrouter.provider.js';
import type { ImageGenerationRequest, ImageGenerationResponse } from '@insforge/shared-schemas';
import logger from '@/utils/logger.js';
import { OpenRouterImageMessage } from '@/types/ai.js';
import { AppError } from '@/api/middlewares/error.js';
import { ERROR_CODES } from '@/types/error-constants.js';

export class ImageGenerationService {
  private static openRouterProvider = OpenRouterProvider.getInstance();

  /**
   * Generate images using the specified model
   * @param options - Image generation options
   */
  static async generate(options: ImageGenerationRequest): Promise<ImageGenerationResponse> {
    const model = options.model;

    try {
      // Build content for the message
      const userContent = options.images?.length
        ? [
            { type: 'text', text: options.prompt },
            ...options.images.map((image) => ({
              type: 'image_url',
              image_url: { url: image.url },
            })),
          ]
        : options.prompt;

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
      const { result: response } = await this.openRouterProvider.sendRequest((client) =>
        client.chat.completions.create(
          request as OpenAI.Chat.ChatCompletionCreateParamsNonStreaming
        )
      );

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

      return result;
    } catch (error) {
      if (error instanceof AppError) {
        throw error;
      }
      logger.error('Image generation error', { error });
      throw new AppError(
        `Failed to generate image: ${error instanceof Error ? error.message : String(error)}`,
        500,
        ERROR_CODES.AI_UPSTREAM_UNAVAILABLE
      );
    }
  }
}
