import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  ERROR_CODES,
  RESERVED_FUNCTION_SLUGS,
  isReservedFunctionSlug,
  uploadFunctionRequestSchema,
} from '@insforge/shared-schemas';
import { FunctionService } from '../../src/services/functions/function.service.js';

const clientQueryMock = vi.fn();
const releaseMock = vi.fn();

const mockPool = {
  query: vi.fn(),
  connect: vi.fn().mockResolvedValue({
    query: clientQueryMock,
    release: releaseMock,
  }),
};

vi.mock('../../src/infra/database/database.manager.js', () => ({
  DatabaseManager: {
    getInstance: () => ({
      getPool: () => mockPool,
    }),
  },
}));

vi.mock('../../src/providers/functions/deno-subhosting.provider.js', () => ({
  DenoSubhostingProvider: {
    getInstance: () => ({
      isConfigured: vi.fn().mockReturnValue(false),
      checkCode: vi.fn().mockResolvedValue(undefined),
    }),
  },
}));

vi.mock('../../src/services/secrets/secret.service.js', () => ({
  SecretService: {
    getInstance: () => ({}),
  },
}));

vi.mock('../../src/utils/logger.js', () => ({
  default: {
    info: vi.fn(),
    error: vi.fn(),
    warn: vi.fn(),
    debug: vi.fn(),
  },
}));

/**
 * Regression tests for issue #1862 — a function slugged `health` deploys
 * successfully but is permanently shadowed by the generated router's built-in
 * health route, so it can never be invoked.
 */
describe('reserved function slugs', () => {
  describe('isReservedFunctionSlug', () => {
    it('flags every reserved slug', () => {
      for (const slug of RESERVED_FUNCTION_SLUGS) {
        expect(isReservedFunctionSlug(slug)).toBe(true);
      }
    });

    it('is case-insensitive, since the router compares a lowercased path', () => {
      expect(isReservedFunctionSlug('Health')).toBe(true);
      expect(isReservedFunctionSlug('HEALTH')).toBe(true);
    });

    it('does not flag slugs that merely contain a reserved word', () => {
      expect(isReservedFunctionSlug('health-check')).toBe(false);
      expect(isReservedFunctionSlug('my-health')).toBe(false);
      expect(isReservedFunctionSlug('healthy')).toBe(false);
    });
  });

  describe('uploadFunctionRequestSchema', () => {
    const base = { name: 'Some Function', code: 'export default () => {}' };

    it('rejects an explicit reserved slug', () => {
      const result = uploadFunctionRequestSchema.safeParse({ ...base, slug: 'health' });
      expect(result.success).toBe(false);
    });

    it('rejects a reserved slug in a different case', () => {
      const result = uploadFunctionRequestSchema.safeParse({ ...base, slug: 'Health' });
      expect(result.success).toBe(false);
    });

    it('still accepts ordinary slugs', () => {
      const result = uploadFunctionRequestSchema.safeParse({ ...base, slug: 'health-check' });
      expect(result.success).toBe(true);
    });

    it('still rejects malformed slugs with the format error', () => {
      const result = uploadFunctionRequestSchema.safeParse({ ...base, slug: 'not a slug' });
      expect(result.success).toBe(false);
      expect(result.error?.issues[0]?.message).toContain('Invalid slug format');
    });
  });

  describe('FunctionService.createFunction', () => {
    let service: FunctionService;

    beforeEach(() => {
      vi.clearAllMocks();
      service = FunctionService.getInstance();
    });

    it('rejects an explicit reserved slug before touching the database', async () => {
      await expect(
        service.createFunction({
          name: 'Health',
          slug: 'health',
          code: 'export default () => {}',
          status: 'active',
        })
      ).rejects.toMatchObject({
        statusCode: 400,
        code: ERROR_CODES.FUNCTION_SLUG_RESERVED,
      });

      expect(mockPool.connect).not.toHaveBeenCalled();
    });

    // The schema's slug refine cannot catch this: with no slug supplied the
    // service derives one from the name, so validation never sees "health".
    it('rejects a reserved slug derived from the function name', async () => {
      await expect(
        service.createFunction({
          name: 'Health',
          code: 'export default () => {}',
          status: 'active',
        })
      ).rejects.toMatchObject({
        statusCode: 400,
        code: ERROR_CODES.FUNCTION_SLUG_RESERVED,
      });

      expect(mockPool.connect).not.toHaveBeenCalled();
    });

    it('allows a non-reserved slug derived from the function name', async () => {
      clientQueryMock
        .mockResolvedValueOnce({}) // INSERT
        .mockResolvedValueOnce({}) // UPDATE deployed_at
        .mockResolvedValueOnce({
          rows: [{ id: 'id-1', slug: 'health-check', name: 'Health Check', status: 'active' }],
        });

      const result = await service.createFunction({
        name: 'Health Check',
        code: 'export default () => {}',
        status: 'active',
      });

      expect(result.function.slug).toBe('health-check');
    });
  });
});
