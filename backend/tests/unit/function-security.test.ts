import { beforeEach, describe, expect, it, vi } from 'vitest';
import { FunctionService } from '../../src/services/functions/function.service.js';

// Mock dependencies
vi.mock('../../src/infra/database/database.manager.js', () => ({
  DatabaseManager: {
    getInstance: () => ({
      getPool: () => ({
        query: vi.fn(),
      }),
    }),
  },
}));

vi.mock('../../src/providers/functions/deno-subhosting.provider.js', () => ({
  DenoSubhostingProvider: {
    getInstance: () => ({}),
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

describe('FunctionService Security Validation', () => {
  let service: FunctionService;

  beforeEach(() => {
    vi.clearAllMocks();
    service = FunctionService.getInstance();
  });

  const validateCode = (code: string) => {
    return (service as any).validateCode(code);
  };

  describe('validateCode', () => {
    it('should allow valid function code', () => {
      const validCode = `
        export default async function(req: Request) {
          const data = await req.json();
          return new Response(JSON.stringify({ hello: 'world' }));
        }
      `;
      expect(() => validateCode(validCode)).not.toThrow();
    });

    it('should block Deno.serve', () => {
      const code = 'Deno.serve((req) => new Response("hi"));';
      expect(() => validateCode(code)).toThrow(/should use "export default async function/i);
    });

    it('should block RCE via Deno.Command', () => {
      const code = 'const cmd = new Deno.Command("rm", { args: ["-rf", "/"] });';
      expect(() => validateCode(code)).toThrow(/potentially dangerous pattern/);
    });

    it('should block RCE via Deno.run', () => {
      const code = 'Deno.run({ cmd: ["ls"] });';
      expect(() => validateCode(code)).toThrow(/potentially dangerous pattern/);
    });

    it('should block dynamic Function constructor (Case Sensitive)', () => {
      const code = 'const f = new Function("return 1");';
      expect(() => validateCode(code)).toThrow(/potentially dangerous pattern/);
    });

    it('should allow "function" keyword', () => {
      const code = 'async function myInternalTask() { return 1; }';
      expect(() => validateCode(code)).not.toThrow();
    });

    it('should block globalThis access', () => {
      const code = 'const secret = globalThis.Deno.env.get("JWT_SECRET");';
      expect(() => validateCode(code)).toThrow(/potentially dangerous pattern/);
    });

    it('should block process access', () => {
      const code = 'const env = process.env;';
      expect(() => validateCode(code)).toThrow(/potentially dangerous pattern/);
    });

    it('should block bracket notation bypass', () => {
      const code = 'const d = globalThis["Deno"];';
      expect(() => validateCode(code)).toThrow(/potentially dangerous pattern/);
    });

    it('should block import statements', () => {
      const code = 'import { readFileSync } from "fs";';
      expect(() => validateCode(code)).toThrow(/potentially dangerous pattern/);
    });

    it('should block eval', () => {
      const code = 'eval("console.log(1)");';
      expect(() => validateCode(code)).toThrow(/potentially dangerous pattern/);
    });
  });
});
