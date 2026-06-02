import { beforeEach, describe, expect, it, vi } from 'vitest';
import { FunctionService } from '../../src/services/functions/function.service.js';

const mockClient = {
  query: vi.fn(),
  release: vi.fn(),
};

const mockPool = {
  query: vi.fn(),
  connect: vi.fn().mockResolvedValue(mockClient),
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

describe('FunctionService Code Validation (Public API)', () => {
  let service: FunctionService;

  beforeEach(() => {
    vi.clearAllMocks();
    service = FunctionService.getInstance();
  });

  const createTestFunction = (code: string) => {
    return service.createFunction({
      slug: 'test-function',
      name: 'Test Function',
      code,
      status: 'active',
      auth: 'user',
    });
  };

  const mockSuccessfulCreate = () => {
    mockClient.query.mockResolvedValueOnce({});
    mockClient.query.mockResolvedValueOnce({});
    mockClient.query.mockResolvedValueOnce({ rows: [{ id: '1' }] });
  };

  describe('Platform contract validation', () => {
    it('should allow valid function code', async () => {
      const validCode = `
        export default async function(req: Request) {
          const data = await req.json();
          return new Response(JSON.stringify({ hello: 'world' }));
        }
      `;

      mockSuccessfulCreate();
      await expect(createTestFunction(validCode)).resolves.toBeDefined();
    });

    it('should block Deno.serve because the platform router handles serving', async () => {
      const code = 'Deno.serve((req) => new Response("hi"));';

      await expect(createTestFunction(code)).rejects.toThrow(/cannot contain Deno\.serve\(\)/i);
    });

    it('should reject simple Deno.serve examples anywhere in source', async () => {
      const code = `
        // Standalone Deno apps often use Deno.serve(() => {}).
        export default async function(req: Request) {
          const docs = "Deno.serve(() => {}) is not used by InsForge functions";
          return new Response(docs);
        }
      `;

      await expect(createTestFunction(code)).rejects.toThrow(/cannot contain Deno\.serve\(\)/i);
    });

    it('should not treat bracket access as an API-layer security boundary', async () => {
      const code = `
        export default async function(req: Request) {
          Deno["serve"](() => new Response("hi"));
          return new Response("ok");
        }
      `;

      mockSuccessfulCreate();
      await expect(createTestFunction(code)).resolves.toBeDefined();
    });
  });

  describe('Runtime responsibility boundaries', () => {
    it('should not reject dangerous-looking words inside comments', async () => {
      const code = `
        // Require authenticated user to invoke this function.
        /*
         * Documentation can mention process, eval, globalThis, require,
         * Deno.spawn, and Deno.Command without turning prose into code.
         */
        export default async function(req: Request) {
          return new Response('ok');
        }
      `;

      mockSuccessfulCreate();
      await expect(createTestFunction(code)).resolves.toBeDefined();
    });

    it('should not reject code-shaped examples inside comments', async () => {
      const code = `
        // Example only: const fs = require("fs")
        /*
         * Avoid process.env.API_KEY, eval("x"), and Deno.spawn("cmd")
         * unless the runtime/provider explicitly supports that behavior.
         */
        export default async function(req: Request) {
          return new Response('ok');
        }
      `;

      mockSuccessfulCreate();
      await expect(createTestFunction(code)).resolves.toBeDefined();
    });

    it('should not reject runtime-sensitive APIs at the API validation layer', async () => {
      const code = `
        export default async function(req: Request) {
          const name = new URL(req.url).searchParams.get('name') ?? 'world';
          const rendered = eval('"hello " + name');
          return new Response(String(rendered));
        }
      `;

      mockSuccessfulCreate();
      await expect(createTestFunction(code)).resolves.toBeDefined();
    });

    it('should not reject dynamic imports or CommonJS-shaped code at the API layer', async () => {
      const code = `
        export default async function(req: Request) {
          const dependency = await import('npm:@insforge/sdk');
          const maybeRequire = 'require("fs") appears only as text here';
          return new Response(JSON.stringify({ dependency: !!dependency, maybeRequire }));
        }
      `;

      mockSuccessfulCreate();
      await expect(createTestFunction(code)).resolves.toBeDefined();
    });

    it('should allow semicolon-free static import statements', async () => {
      const code = `
        import { createClient } from 'npm:@insforge/sdk'
        export default async function(req: Request) {
          return new Response(String(Boolean(createClient)))
        }
      `;

      mockSuccessfulCreate();
      await expect(createTestFunction(code)).resolves.toBeDefined();
    });
  });

  describe('Function Auth Policy', () => {
    it('should default auth to "user" when not provided', async () => {
      const code = `export default async function(req) { return new Response('ok'); }`;
      const uuid = '550e8400-e29b-41d4-a716-446655440000';

      // Mock the INSERT query
      mockClient.query.mockResolvedValueOnce({});
      // Mock the status UPDATE
      mockClient.query.mockResolvedValueOnce({});
      // Mock the SELECT to return created function
      mockClient.query.mockResolvedValueOnce({
        rows: [
          {
            id: uuid,
            slug: 'test-function',
            name: 'Test Function',
            code,
            status: 'active',
            auth: 'user', // Should default to 'user'
            createdAt: '2026-06-01T00:00:00Z',
            updatedAt: '2026-06-01T00:00:00Z',
            deployedAt: '2026-06-01T00:00:00Z',
          },
        ],
      });

      const result = await service.createFunction({
        slug: 'test-function',
        name: 'Test Function',
        code,
        status: 'active',
        auth: 'user',
      });

      expect(result.function.auth).toBe('user');

      // Verify INSERT included auth='user'
      const insertCall = mockClient.query.mock.calls.find(
        ([sql]) => typeof sql === 'string' && sql.includes('INSERT INTO functions.definitions')
      );
      expect(insertCall?.[0]).toContain('auth');
      expect(insertCall?.[1]).toContain('user');
    });

    it('should allow creating function with auth="admin"', async () => {
      const code = `export default async function(req) { return new Response('ok'); }`;
      const uuid = '550e8400-e29b-41d4-a716-446655440001';

      mockClient.query.mockResolvedValueOnce({});
      mockClient.query.mockResolvedValueOnce({});
      mockClient.query.mockResolvedValueOnce({
        rows: [
          {
            id: uuid,
            slug: 'admin-func',
            name: 'Admin Function',
            code,
            status: 'active',
            auth: 'admin',
            createdAt: '2026-06-01T00:00:00Z',
            updatedAt: '2026-06-01T00:00:00Z',
            deployedAt: '2026-06-01T00:00:00Z',
          },
        ],
      });

      const result = await service.createFunction({
        slug: 'admin-func',
        name: 'Admin Function',
        code,
        status: 'active',
        auth: 'admin',
      });

      expect(result.function.auth).toBe('admin');

      const insertCall = mockClient.query.mock.calls.find(
        ([sql]) => typeof sql === 'string' && sql.includes('INSERT INTO functions.definitions')
      );
      expect(insertCall?.[1]).toContain('admin');
    });

    it('should allow creating function with auth="none"', async () => {
      const code = `export default async function(req) { return new Response('ok'); }`;
      const uuid = '550e8400-e29b-41d4-a716-446655440002';

      mockClient.query.mockResolvedValueOnce({});
      mockClient.query.mockResolvedValueOnce({
        rows: [
          {
            id: uuid,
            slug: 'public-func',
            name: 'Public Function',
            code,
            status: 'draft',
            auth: 'none',
            createdAt: '2026-06-01T00:00:00Z',
            updatedAt: '2026-06-01T00:00:00Z',
            deployedAt: null,
          },
        ],
      });

      const result = await service.createFunction({
        slug: 'public-func',
        name: 'Public Function',
        code,
        status: 'draft',
        auth: 'none',
      });

      expect(result.function.auth).toBe('none');
    });

    it('should include auth field in getFunction response', async () => {
      const uuid = '550e8400-e29b-41d4-a716-446655440003';

      mockPool.query.mockResolvedValueOnce({
        rows: [
          {
            id: uuid,
            slug: 'test-function',
            name: 'Test Function',
            code: 'export default...',
            status: 'active',
            auth: 'user',
            createdAt: '2026-06-01T00:00:00Z',
            updatedAt: '2026-06-01T00:00:00Z',
            deployedAt: '2026-06-01T00:00:00Z',
          },
        ],
      });

      const result = await service.getFunction('test-function');

      expect(result).toBeDefined();
      expect(result?.auth).toBe('user');
    });

    it('should allow updating function auth policy', async () => {
      const uuid = '550e8400-e29b-41d4-a716-446655440004';

      // Mock finding the function
      mockClient.query.mockResolvedValueOnce({ rows: [{ id: uuid }] });
      // Mock auth UPDATE
      mockClient.query.mockResolvedValueOnce({});
      // Mock updated_at UPDATE
      mockClient.query.mockResolvedValueOnce({});
      // Mock SELECT to return updated function
      mockClient.query.mockResolvedValueOnce({
        rows: [
          {
            id: uuid,
            slug: 'test-function',
            name: 'Test Function',
            code: 'export default...',
            status: 'active',
            auth: 'admin', // Changed from 'user' to 'admin'
            createdAt: '2026-06-01T00:00:00Z',
            updatedAt: '2026-06-01T01:00:00Z',
            deployedAt: '2026-06-01T00:00:00Z',
          },
        ],
      });

      const result = await service.updateFunction('test-function', {
        auth: 'admin',
      });

      expect(result).toBeDefined();
      expect(result?.function.auth).toBe('admin');

      const authUpdateCall = mockClient.query.mock.calls.find(
        ([sql]) => typeof sql === 'string' && sql.includes('UPDATE functions.definitions SET auth')
      );
      expect(authUpdateCall).toBeDefined();
      expect(authUpdateCall?.[1]).toContain('admin');
    });
  });
});
