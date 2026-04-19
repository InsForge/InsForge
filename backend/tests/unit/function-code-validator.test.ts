import { describe, test, expect } from 'vitest';
import { validateFunctionCode } from '../../src/utils/function-code-validator.js';
import { AppError } from '../../src/api/middlewares/error.js';

describe('validateFunctionCode', () => {
  describe('valid code', () => {
    test('accepts a plain export default function', () => {
      const code = `
        export default async function(req: Request): Promise<Response> {
          return new Response('hello');
        }
      `;
      expect(() => validateFunctionCode(code)).not.toThrow();
    });

    test('accepts code that references run in a string literal', () => {
      const code = `
        export default async function(req: Request) {
          const msg = "don't run this";
          return new Response(msg);
        }
      `;
      expect(() => validateFunctionCode(code)).not.toThrow();
    });
  });

  describe('Deno.serve() guard', () => {
    test('rejects Deno.serve()', () => {
      const code = `Deno.serve(async (req) => new Response('hi'));`;
      expect(() => validateFunctionCode(code)).toThrow(AppError);
    });
  });

  describe('existing dangerous patterns (dot-notation)', () => {
    test('rejects Deno.run', () => {
      const code = `const p = Deno.run({ cmd: ['ls'] });`;
      expect(() => validateFunctionCode(code)).toThrow(AppError);
    });

    test('rejects Deno.spawn', () => {
      const code = `const p = Deno.spawn('ls');`;
      expect(() => validateFunctionCode(code)).toThrow(AppError);
    });

    test('rejects Deno.Command', () => {
      const code = `new Deno.Command('ls').output();`;
      expect(() => validateFunctionCode(code)).toThrow(AppError);
    });

    test('rejects child_process reference', () => {
      const code = `import cp from 'child_process';`;
      expect(() => validateFunctionCode(code)).toThrow(AppError);
    });

    test('rejects process.exit', () => {
      const code = `process.exit(1);`;
      expect(() => validateFunctionCode(code)).toThrow(AppError);
    });

    test('rejects require("fs")', () => {
      const code = `const fs = require("fs");`;
      expect(() => validateFunctionCode(code)).toThrow(AppError);
    });
  });

  describe('bracket-notation bypass (regression for #1104)', () => {
    test('rejects Deno["run"]', () => {
      const code = `
        export default async function(req: Request) {
          const p = await Deno["run"]({ cmd: ["cat", "/etc/passwd"], stdout: "piped" });
          return new Response(new TextDecoder().decode(await p.output()));
        }
      `;
      expect(() => validateFunctionCode(code)).toThrow(AppError);
    });

    test("rejects Deno['run']", () => {
      const code = `const p = Deno['run']({ cmd: ['ls'] });`;
      expect(() => validateFunctionCode(code)).toThrow(AppError);
    });

    test('rejects Deno[variable] dynamic property access', () => {
      const code = `
        export default async function(req: Request) {
          const action = "run";
          const p = await Deno[action]({ cmd: ["cat", "/etc/passwd"], stdout: "piped" });
          return new Response(new TextDecoder().decode(await p.output()));
        }
      `;
      expect(() => validateFunctionCode(code)).toThrow(AppError);
    });

    test('rejects Deno[ with whitespace before bracket', () => {
      const code = `Deno ['run']({ cmd: ['ls'] });`;
      expect(() => validateFunctionCode(code)).toThrow(AppError);
    });
  });

  describe('global scope bypass', () => {
    test('rejects globalThis.Deno.run()', () => {
      const code = `const p = globalThis.Deno.run({ cmd: ['ls'] });`;
      expect(() => validateFunctionCode(code)).toThrow(AppError);
    });

    test('rejects self.Deno.run()', () => {
      const code = `const p = self.Deno.run({ cmd: ['ls'] });`;
      expect(() => validateFunctionCode(code)).toThrow(AppError);
    });
  });

  describe('dynamic code evaluation', () => {
    test('rejects eval()', () => {
      const code = `eval("Deno.run({ cmd: ['ls'] })");`;
      expect(() => validateFunctionCode(code)).toThrow(AppError);
    });

    test('rejects new Function()', () => {
      const code = `const fn = new Function('return Deno.run({cmd:["ls"]})');`;
      expect(() => validateFunctionCode(code)).toThrow(AppError);
    });
  });

  describe('dangerous module imports', () => {
    test('rejects static import from node:child_process', () => {
      const code = `import { exec } from "node:child_process";`;
      expect(() => validateFunctionCode(code)).toThrow(AppError);
    });

    test('rejects dynamic import of node:child_process', () => {
      const code = `const { exec } = await import("node:child_process");`;
      expect(() => validateFunctionCode(code)).toThrow(AppError);
    });

    test('rejects static import from npm:child_process', () => {
      const code = `import { exec } from "npm:child_process";`;
      expect(() => validateFunctionCode(code)).toThrow(AppError);
    });
  });

  describe('error messages', () => {
    test('AppError from bracket-notation block has status 400', () => {
      const code = `Deno["run"]({ cmd: ['ls'] });`;
      try {
        validateFunctionCode(code);
        expect.fail('should have thrown');
      } catch (e) {
        expect(e).toBeInstanceOf(AppError);
        expect((e as AppError).statusCode).toBe(400);
      }
    });
  });
});
