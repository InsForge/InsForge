import { AppError } from '@/api/middlewares/error.js';
import { ERROR_CODES } from '@/types/error-constants.js';

// Defense-in-depth only. Runtime-level Deno permissions are the primary
// enforcement layer. These patterns block the most obvious attack vectors
// including bracket-notation bypasses (e.g. Deno["run"]).
const DANGEROUS_PATTERNS: Array<{ pattern: RegExp; label: string }> = [
  // Dot-notation
  { pattern: /Deno\.run/i, label: 'Deno.run' },
  { pattern: /Deno\.spawn/i, label: 'Deno.spawn' },
  { pattern: /Deno\.Command/i, label: 'Deno.Command' },
  // Bracket-notation bypass: Deno["run"], Deno['run'], Deno[variable]
  { pattern: /Deno\s*\[/, label: 'Deno bracket notation' },
  // Global-scope bypass: globalThis.Deno, self.Deno
  { pattern: /globalThis\s*\.\s*Deno\b/, label: 'globalThis.Deno' },
  { pattern: /\bself\s*\.\s*Deno\b/, label: 'self.Deno' },
  // Node.js / process escape hatches
  { pattern: /child_process/i, label: 'child_process' },
  { pattern: /process\.exit/i, label: 'process.exit' },
  { pattern: /require\s*\(\s*['"]fs['"]\s*\)/i, label: 'require("fs")' },
  // Dynamic code evaluation
  { pattern: /\beval\s*\(/, label: 'eval()' },
  { pattern: /new\s+Function\s*\(/, label: 'new Function()' },
  // Dangerous module specifiers (static and dynamic imports)
  { pattern: /from\s+['"]node:child_process['"]/i, label: 'node:child_process import' },
  {
    pattern: /import\s*\(\s*['"]node:child_process['"]\s*\)/i,
    label: 'node:child_process dynamic import',
  },
  { pattern: /from\s+['"]npm:child_process['"]/i, label: 'npm:child_process import' },
];

export function validateFunctionCode(code: string): void {
  if (/Deno\.serve\s*\(/.test(code)) {
    throw new AppError(
      'Functions should use "export default async function(req: Request)" instead of "Deno.serve()". The router handles serving automatically.',
      400,
      ERROR_CODES.INVALID_INPUT
    );
  }

  for (const { pattern, label } of DANGEROUS_PATTERNS) {
    if (pattern.test(code)) {
      throw new AppError(
        `Code contains a potentially dangerous pattern: ${label}`,
        400,
        ERROR_CODES.INVALID_INPUT
      );
    }
  }
}
