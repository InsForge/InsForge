import { ERROR_CODES } from '@insforge/shared-schemas';
import { AppError } from '@/utils/errors.js';

export const DEFAULT_EMBED_MODEL = 'openai/text-embedding-3-small';
/** Width of `memory.memories.embedding` (`VECTOR(1536)`). Other widths cannot be stored. */
export const DEFAULT_EMBED_DIMENSIONS = 1536;
// Shipped default from in-repo eval (text-embedding-3-small, limit=5): see
// ./eval/results/baseline-limit5.json and ./eval/README.md. Override via MEMORY_RECALL_THRESHOLD.
export const DEFAULT_RECALL_THRESHOLD = 0.35;

export interface MemoryRetrievalConfig {
  embedModel: string;
  embedDimensions: number;
  defaultRecallThreshold: number;
}

function envString(env: NodeJS.ProcessEnv, key: string): string | undefined {
  const raw = env[key]?.trim();
  return raw ? raw : undefined;
}

/** OpenRouter/OpenAI model id used for remember() and recall() embeddings. */
export function resolveEmbedModel(env: NodeJS.ProcessEnv = process.env): string {
  return envString(env, 'MEMORY_EMBED_MODEL') ?? DEFAULT_EMBED_MODEL;
}

/**
 * Embedding width sent to the provider. Must equal the pgvector column width
 * (`VECTOR(1536)`) until a migration widens `memory.memories.embedding`.
 */
export function resolveEmbedDimensions(env: NodeJS.ProcessEnv = process.env): number {
  const raw = envString(env, 'MEMORY_EMBED_DIMENSIONS');
  if (!raw) {
    return DEFAULT_EMBED_DIMENSIONS;
  }
  const dimensions = Number(raw);
  if (!Number.isInteger(dimensions) || dimensions <= 0) {
    throw new AppError(
      `MEMORY_EMBED_DIMENSIONS must be a positive integer, got "${raw}"`,
      500,
      ERROR_CODES.INTERNAL_ERROR
    );
  }
  if (dimensions !== DEFAULT_EMBED_DIMENSIONS) {
    throw new AppError(
      `MEMORY_EMBED_DIMENSIONS must be ${DEFAULT_EMBED_DIMENSIONS} ` +
        `(memory.memories.embedding is VECTOR(${DEFAULT_EMBED_DIMENSIONS})); got "${raw}"`,
      500,
      ERROR_CODES.INTERNAL_ERROR
    );
  }
  return dimensions;
}

/** Default vector-arm cosine floor when a recall request omits `threshold`. */
export function resolveRecallThreshold(env: NodeJS.ProcessEnv = process.env): number {
  const raw = envString(env, 'MEMORY_RECALL_THRESHOLD');
  if (!raw) {
    return DEFAULT_RECALL_THRESHOLD;
  }
  const recallThreshold = Number(raw);
  if (!Number.isFinite(recallThreshold) || recallThreshold < 0 || recallThreshold > 1) {
    throw new AppError(
      `MEMORY_RECALL_THRESHOLD must be a number between 0 and 1, got "${raw}"`,
      500,
      ERROR_CODES.INTERNAL_ERROR
    );
  }
  return recallThreshold;
}

/** Read retrieval knobs from env. Call per request so eval sweeps do not need a source edit. */
export function getMemoryRetrievalConfig(
  env: NodeJS.ProcessEnv = process.env
): MemoryRetrievalConfig {
  return {
    embedModel: resolveEmbedModel(env),
    embedDimensions: resolveEmbedDimensions(env),
    defaultRecallThreshold: resolveRecallThreshold(env),
  };
}
