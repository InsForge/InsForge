import OpenAI from 'openai';
import { appConfig } from '@/infra/config/app.config.js';
import logger from '@/utils/logger.js';

/**
 * Optional prompt compression for the Model Gateway (default OFF).
 *
 * When `AI_COMPRESSION_URL` points at a leanctx compression sidecar, the
 * formatted chat messages are sent to its `POST /compress` endpoint before they
 * go upstream to OpenRouter. The sidecar shrinks the natural-language ("prose")
 * portions of system/user/assistant messages and forwards tool results and
 * multimodal content verbatim, cutting prompt tokens — and therefore OpenRouter
 * cost — with no change to the request schema, the route, or the public API.
 *
 * The path is strictly **fail-open**: when the feature is unset it is a no-op,
 * and any error, timeout, non-OK status, or message-count mismatch falls back
 * to the original messages. The gateway never depends on the sidecar for
 * availability or correctness.
 *
 * Sidecar: https://pypi.org/project/leanctx/ (`leanctx-serve`).
 */

type ChatMessage = OpenAI.Chat.ChatCompletionMessageParam;

interface CompressResponse {
  messages?: unknown;
}

const COMPRESS_PATH = '/compress';

/** True when a compression sidecar URL is configured. */
export function isCompressionEnabled(): boolean {
  return Boolean(appConfig.ai.compressionUrl);
}

/** Total length of the plain-string content the sidecar could actually shrink. */
function compressibleChars(messages: ChatMessage[]): number {
  let total = 0;
  for (const message of messages) {
    if (typeof message.content === 'string') {
      total += message.content.length;
    }
  }
  return total;
}

/**
 * Compress messages via the leanctx sidecar, or return them unchanged.
 *
 * @param messages - Formatted OpenAI chat messages, as built by
 *   `ChatCompletionService.formatMessages`.
 * @returns The compressed messages (same count, same order) when the sidecar is
 *   configured and responds successfully; otherwise the original messages.
 */
export async function compressMessages(messages: ChatMessage[]): Promise<ChatMessage[]> {
  const baseUrl = appConfig.ai.compressionUrl;
  if (!baseUrl) {
    // Feature off → no-op, fully backward compatible.
    return messages;
  }

  // Request-level gate: don't pay the sidecar round-trip on small prompts. The
  // sidecar also enforces a per-message token floor, but short-circuiting tiny
  // requests here keeps the added latency off the common path.
  if (compressibleChars(messages) < appConfig.ai.compressionMinChars) {
    return messages;
  }

  const url = `${baseUrl.replace(/\/+$/, '')}${COMPRESS_PATH}`;
  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ messages }),
      signal: AbortSignal.timeout(appConfig.ai.compressionTimeoutMs),
    });

    if (!response.ok) {
      logger.warn('Prompt compression sidecar returned a non-OK status; using original messages', {
        status: response.status,
      });
      return messages;
    }

    const data = (await response.json()) as CompressResponse;
    const compressed = data.messages;

    // One-in-one-out invariant: the sidecar preserves message count (it splices
    // compressed prose back by index and forwards everything else verbatim). If
    // that ever breaks, discard the result rather than risk dropping, adding, or
    // reordering a message.
    if (!Array.isArray(compressed) || compressed.length !== messages.length) {
      logger.warn(
        'Prompt compression returned an unexpected message count; using original messages',
        {
          expected: messages.length,
          received: Array.isArray(compressed) ? compressed.length : null,
        }
      );
      return messages;
    }

    return compressed as ChatMessage[];
  } catch (error) {
    // Fail open: compression must never break or stall a chat request.
    logger.warn('Prompt compression failed; using original messages', {
      error: error instanceof Error ? error.message : String(error),
    });
    return messages;
  }
}
