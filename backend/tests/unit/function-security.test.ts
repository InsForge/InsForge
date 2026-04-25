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

describe('FunctionService Security Validation (Public API)', () => {
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

  describe('Security Patterns', () => {
    it('should allow valid function code', async () => {
      const validCode = `
        export default async function(req: Request) {
          const data = await req.json();
          return new Response(JSON.stringify({ hello: 'world' }));
        }
      `;
      mockClient.query.mockResolvedValueOnce({}); // Insert
      mockClient.query.mockResolvedValueOnce({}); // Update
      mockClient.query.mockResolvedValueOnce({ rows: [{ id: '1' }] }); // Select
      await expect(createTestFunction(validCode)).resolves.toBeDefined();
    });

    it('should allow identifiers containing "self" (Regression Fix)', async () => {
      const code = 'const myself = { name: "test" }; return myself;';
      mockClient.query.mockResolvedValueOnce({}); // Insert
      mockClient.query.mockResolvedValueOnce({}); // Update
      mockClient.query.mockResolvedValueOnce({ rows: [{ id: '1' }] }); // Select
      await expect(createTestFunction(code)).resolves.toBeDefined();
    });

    it('should allow string array literals (Regression Fix)', async () => {
      const code = "const arr = ['a', 'b']; return new Response(arr.join(','));";
      mockClient.query.mockResolvedValueOnce({}); // Insert
      mockClient.query.mockResolvedValueOnce({}); // Update
      mockClient.query.mockResolvedValueOnce({ rows: [{ id: '1' }] }); // Select
      await expect(createTestFunction(code)).resolves.toBeDefined();
    });

    it('should block self access (Word Boundary)', async () => {
      const code = 'const x = self.postMessage;';
      await expect(createTestFunction(code)).rejects.toThrow(/potentially dangerous pattern/);
    });

    it('should block constructor access', async () => {
      const code = 'const proto = obj.constructor.prototype;';
      await expect(createTestFunction(code)).rejects.toThrow(/potentially dangerous pattern/);
    });

    it('should block Deno.serve', async () => {
      const code = 'Deno.serve((req) => new Response("hi"));';
      await expect(createTestFunction(code)).rejects.toThrow(
        /should use "export default async function/i
      );
    });

    it('should block RCE via Deno.Command', async () => {
      const code = 'const cmd = new Deno.Command("rm", { args: ["-rf", "/"] });';
      await expect(createTestFunction(code)).rejects.toThrow(/potentially dangerous pattern/);
    });

    it('should block dynamic Function constructor', async () => {
      const code = 'const f = new Function("return 1");';
      await expect(createTestFunction(code)).rejects.toThrow(/potentially dangerous pattern/);
    });

    it('should block bracket notation bypass (Deno)', async () => {
      const code = 'const d = globalThis["Deno"];';
      await expect(createTestFunction(code)).rejects.toThrow(/potentially dangerous pattern/);
    });

    it('should block bracket notation bypass (process)', async () => {
      const code = 'const p = globalThis["process"];';
      await expect(createTestFunction(code)).rejects.toThrow(/potentially dangerous pattern/);
    });

    it('should block eval', async () => {
      const code = 'eval("console.log(1)");';
      await expect(createTestFunction(code)).rejects.toThrow(/potentially dangerous pattern/);
    });
  });
});
