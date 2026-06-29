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
      checkCode: vi.fn(),
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
});
