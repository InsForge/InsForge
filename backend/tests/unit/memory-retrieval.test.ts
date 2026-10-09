import { describe, expect, it } from 'vitest';
import { ERROR_CODES } from '@insforge/shared-schemas';
import { AppError } from '../../src/utils/errors';
import {
  DEFAULT_EMBED_DIMENSIONS,
  DEFAULT_EMBED_MODEL,
  DEFAULT_RECALL_THRESHOLD,
  getMemoryRetrievalConfig,
  resolveEmbedDimensions,
  resolveEmbedModel,
  resolveRecallThreshold,
} from '../../src/services/memory/memory-retrieval';

describe('memory retrieval config', () => {
  it('uses shipped defaults when env is unset', () => {
    const empty = {} as NodeJS.ProcessEnv;
    expect(resolveEmbedModel(empty)).toBe(DEFAULT_EMBED_MODEL);
    expect(resolveEmbedDimensions(empty)).toBe(DEFAULT_EMBED_DIMENSIONS);
    expect(resolveRecallThreshold(empty)).toBe(DEFAULT_RECALL_THRESHOLD);
    expect(getMemoryRetrievalConfig(empty)).toEqual({
      embedModel: DEFAULT_EMBED_MODEL,
      embedDimensions: DEFAULT_EMBED_DIMENSIONS,
      defaultRecallThreshold: DEFAULT_RECALL_THRESHOLD,
    });
  });

  it('reads MEMORY_EMBED_MODEL and MEMORY_EMBED_DIMENSIONS=1536', () => {
    const env = {
      MEMORY_EMBED_MODEL: '  openai/text-embedding-3-large  ',
      MEMORY_EMBED_DIMENSIONS: '1536',
    } as NodeJS.ProcessEnv;
    expect(resolveEmbedModel(env)).toBe('openai/text-embedding-3-large');
    expect(resolveEmbedDimensions(env)).toBe(DEFAULT_EMBED_DIMENSIONS);
  });

  it('reads MEMORY_RECALL_THRESHOLD including 0', () => {
    expect(resolveRecallThreshold({ MEMORY_RECALL_THRESHOLD: '0.35' } as NodeJS.ProcessEnv)).toBe(
      0.35
    );
    expect(resolveRecallThreshold({ MEMORY_RECALL_THRESHOLD: '0' } as NodeJS.ProcessEnv)).toBe(0);
    expect(resolveRecallThreshold({ MEMORY_RECALL_THRESHOLD: '1' } as NodeJS.ProcessEnv)).toBe(1);
  });

  it('rejects invalid threshold and dimensions', () => {
    expect(() =>
      resolveRecallThreshold({ MEMORY_RECALL_THRESHOLD: '1.5' } as NodeJS.ProcessEnv)
    ).toThrow(AppError);
    try {
      resolveRecallThreshold({ MEMORY_RECALL_THRESHOLD: 'nope' } as NodeJS.ProcessEnv);
    } catch (err) {
      expect(err).toBeInstanceOf(AppError);
      expect((err as AppError).code).toBe(ERROR_CODES.INTERNAL_ERROR);
    }
    expect(() =>
      resolveEmbedDimensions({ MEMORY_EMBED_DIMENSIONS: '1.5' } as NodeJS.ProcessEnv)
    ).toThrow(AppError);
    expect(() =>
      resolveEmbedDimensions({ MEMORY_EMBED_DIMENSIONS: '-4' } as NodeJS.ProcessEnv)
    ).toThrow(AppError);
    expect(() =>
      resolveEmbedDimensions({ MEMORY_EMBED_DIMENSIONS: '3072' } as NodeJS.ProcessEnv)
    ).toThrow(AppError);
  });
});
