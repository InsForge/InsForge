import { readFileSync } from 'fs';
import { join } from 'path';
import vm from 'vm';
import { describe, expect, it } from 'vitest';

/**
 * `functions/handler-format.js` is plain JS with no import/export of its own
 * (see file header) so it can be concatenated ahead of `worker-template.js`
 * for the Deno worker. Load its real source here via `vm` — rather than
 * re-implementing the regex in this test — so the test tracks the exact code
 * that ships, with no risk of drifting from it.
 */
function loadNormalizeHandlerFormat(): (code: string) => string {
  const source = readFileSync(join(__dirname, '../../../functions/handler-format.js'), 'utf-8');
  const context: { normalizeHandlerFormat?: (code: string) => string } = {};
  vm.createContext(context);
  vm.runInContext(`${source}\nthis.normalizeHandlerFormat = normalizeHandlerFormat;`, context);
  if (typeof context.normalizeHandlerFormat !== 'function') {
    throw new Error('normalizeHandlerFormat was not defined by handler-format.js');
  }
  return context.normalizeHandlerFormat;
}

describe('normalizeHandlerFormat (functions/handler-format.js)', () => {
  const normalizeHandlerFormat = loadNormalizeHandlerFormat();

  it('leaves legacy module.exports handlers untouched', () => {
    const code = `module.exports = async function (request) {
  return new Response("hi");
};`;
    expect(normalizeHandlerFormat(code)).toBe(code);
  });

  it('rewrites the documented "export default" handler into module.exports', () => {
    const code = `import { createClient } from 'npm:@insforge/sdk';

export default async function (req) {
  return new Response("hi");
}`;

    const result = normalizeHandlerFormat(code);

    expect(result).not.toMatch(/\bimport\b/);
    expect(result).not.toMatch(/\bexport\s+default\b/);
    expect(result).toContain('module.exports = async function (req) {');

    // The rewritten source must actually be usable by `new Function(...)`,
    // the same execution path worker-template.js uses.
    const wrapper = new Function('exports', 'module', result);
    const exportsObj: Record<string, unknown> = {};
    const moduleObj = { exports: exportsObj };
    wrapper(exportsObj, moduleObj);
    expect(typeof moduleObj.exports).toBe('function');
  });

  it('rewrites a named "export default function handler"', () => {
    const code = `export default async function handler(req) {
  return new Response("hi");
}`;

    const result = normalizeHandlerFormat(code);
    expect(result).toBe(`module.exports = async function handler(req) {
  return new Response("hi");
}`);
  });

  it('rewrites an "export default" arrow function', () => {
    const code = `export default async (req) => new Response("hi");`;
    const result = normalizeHandlerFormat(code);
    expect(result).toBe('module.exports = async (req) => new Response("hi");');
  });

  it('strips the base64 std import alongside the SDK import', () => {
    const code = `import { createClient } from 'npm:@insforge/sdk';
import { encodeBase64, decodeBase64 } from 'https://deno.land/std@0.224.0/encoding/base64.ts';

export default async function (req) {
  return new Response(encodeBase64(new Uint8Array()));
}`;

    const result = normalizeHandlerFormat(code);
    expect(result).not.toMatch(/\bimport\b/);
    expect(result).toContain('module.exports = async function (req) {');
  });

  it('leaves unrecognized imports untouched (not silently swallowed)', () => {
    const code = `import { something } from 'npm:some-other-package';

export default async function (req) {
  return new Response(something());
}`;

    const result = normalizeHandlerFormat(code);
    expect(result).toContain("import { something } from 'npm:some-other-package';");
    expect(result).toContain('module.exports = async function (req) {');
  });

  // Regression coverage for review findings on the PR that introduced this
  // file — each of these previously produced a `new Function` SyntaxError or
  // ReferenceError under the documented format.

  it('strips the documented TypeScript-typed signature (parameter and return types)', () => {
    const code = `import { createClient } from 'npm:@insforge/sdk';

export default async function (req: Request): Promise<Response> {
  return new Response("hi");
}`;

    const result = normalizeHandlerFormat(code);
    expect(result).not.toMatch(/:\s*Request/);
    expect(result).not.toMatch(/Promise<Response>/);

    const wrapper = new Function('exports', 'module', 'createClient', result);
    const exportsObj: Record<string, unknown> = {};
    const moduleObj = { exports: exportsObj };
    wrapper(exportsObj, moduleObj, () => ({}));
    expect(typeof moduleObj.exports).toBe('function');
  });

  it('strips types from multiple parameters, including a generic with an internal comma', async () => {
    const code = `export default async function (req: Request, opts: Record<string, string> = {}): Promise<Response> {
  return new Response(JSON.stringify(opts));
}`;

    const result = normalizeHandlerFormat(code);
    const wrapper = new Function('exports', 'module', result);
    const exportsObj: Record<string, unknown> = {};
    const moduleObj = { exports: exportsObj };
    wrapper(exportsObj, moduleObj);
    const handler = moduleObj.exports as (req: unknown) => Promise<{ text(): Promise<string> }>;
    expect(typeof handler).toBe('function');
    const response = await handler({});
    expect(await response.text()).toBe('{}');
  });

  it('strips types from a typed arrow-function handler', () => {
    const code = `export default async (req: Request): Promise<Response> => {
  return new Response("hi");
};`;

    const result = normalizeHandlerFormat(code);
    const wrapper = new Function('exports', 'module', result);
    const exportsObj: Record<string, unknown> = {};
    const moduleObj = { exports: exportsObj };
    wrapper(exportsObj, moduleObj);
    expect(typeof moduleObj.exports).toBe('function');
  });

  it('does not skip normalization when "module.exports" only appears in a comment', () => {
    const code = `// previously: module.exports = async function (req) { ... }
export default async function (req: Request): Promise<Response> {
  return new Response("hi");
}`;

    const result = normalizeHandlerFormat(code);
    expect(result).toMatch(/^\/\/ previously:/);
    expect(result).toContain('module.exports = async function');
    expect(result).not.toMatch(/export\s+default/);

    const wrapper = new Function('exports', 'module', result);
    const exportsObj: Record<string, unknown> = {};
    const moduleObj = { exports: exportsObj };
    wrapper(exportsObj, moduleObj);
    expect(typeof moduleObj.exports).toBe('function');
  });

  it('rewrites an aliased SDK import into a local const binding', async () => {
    const code = `import { createClient as makeClient } from 'npm:@insforge/sdk';

export default async function (req: Request): Promise<Response> {
  const client = makeClient({});
  return new Response(typeof client);
}`;

    const result = normalizeHandlerFormat(code);
    expect(result).not.toMatch(/\bimport\b/);
    expect(result).toContain('const makeClient = createClient;');

    const wrapper = new Function('exports', 'module', 'createClient', result);
    const exportsObj: Record<string, unknown> = {};
    const moduleObj = { exports: exportsObj };
    wrapper(exportsObj, moduleObj, () => ({}));
    const handler = moduleObj.exports as (req: unknown) => Promise<{ text(): Promise<string> }>;
    const response = await handler({});
    expect(await response.text()).toBe('object');
  });

  it('leaves the whole import untouched when it mixes a known and unknown SDK binding', () => {
    const code = `import { createClient, somethingElse } from 'npm:@insforge/sdk';

export default async function (req: Request): Promise<Response> {
  return new Response(somethingElse());
}`;

    const result = normalizeHandlerFormat(code);
    expect(result).toContain("import { createClient, somethingElse } from 'npm:@insforge/sdk';");
    expect(result).toContain('module.exports = async function');
  });

  it('leaves an unparseable/unrecognized signature completely untouched', () => {
    // Not a function/arrow expression at all — normalizeHandlerFormat should
    // bail out rather than guess, reproducing the pre-existing plain error.
    const code = `export default someModule.handler;`;
    const result = normalizeHandlerFormat(code);
    expect(result).toBe('module.exports = someModule.handler;');
  });

  // Round-2 regression coverage: a second review pass on the fixes above
  // found further edge cases in the type-annotation stripping and the
  // string/comment-unaware regex matching. Each of these previously either
  // produced invalid JavaScript or was incorrectly rewritten/skipped.

  it('does not corrupt a ternary expression used as a parameter default value', async () => {
    const code = `export default async function (req: Request, opts: string = true ? "a" : "b"): Promise<Response> {
  return new Response(opts);
}`;

    const result = normalizeHandlerFormat(code);
    const wrapper = new Function('exports', 'module', result);
    const exportsObj: Record<string, unknown> = {};
    const moduleObj = { exports: exportsObj };
    wrapper(exportsObj, moduleObj);
    const handler = moduleObj.exports as (req: unknown) => Promise<{ text(): Promise<string> }>;
    const response = await handler({});
    expect(await response.text()).toBe('a');
  });

  it('does not treat a function-type parameter arrow as a default-value marker', () => {
    const code = `export default async function (req: Request, cb: () => void): Promise<Response> {
  cb();
  return new Response("hi");
}`;

    const result = normalizeHandlerFormat(code);
    const wrapper = new Function('exports', 'module', result);
    const exportsObj: Record<string, unknown> = {};
    const moduleObj = { exports: exportsObj };
    wrapper(exportsObj, moduleObj);
    const handler = moduleObj.exports as (req: unknown, cb: () => void) => unknown;
    let called = false;
    handler({}, () => {
      called = true;
    });
    expect(called).toBe(true);
  });

  it('strips a return type that itself contains an object-literal type', () => {
    const code = `export default async function (req: Request): Promise<{ status: number }> {
  return { status: 200 };
}`;

    const result = normalizeHandlerFormat(code);
    expect(result).not.toMatch(/Promise</);
    const wrapper = new Function('exports', 'module', result);
    const exportsObj: Record<string, unknown> = {};
    const moduleObj = { exports: exportsObj };
    wrapper(exportsObj, moduleObj);
    const handler = moduleObj.exports as (req: unknown) => Promise<{ status: number }>;
    expect(typeof handler).toBe('function');
  });

  it('does not rewrite import-shaped text inside a template literal', async () => {
    const code = `export default async function (req: Request): Promise<Response> {
  const msg = \`import { createClient } from 'npm:@insforge/sdk';\`;
  return new Response(msg);
}`;

    const result = normalizeHandlerFormat(code);
    expect(result).toContain("const msg = `import { createClient } from 'npm:@insforge/sdk';`;");
    const wrapper = new Function('exports', 'module', result);
    const exportsObj: Record<string, unknown> = {};
    const moduleObj = { exports: exportsObj };
    wrapper(exportsObj, moduleObj);
    const handler = moduleObj.exports as (req: unknown) => Promise<{ text(): Promise<string> }>;
    const response = await handler({});
    expect(await response.text()).toBe("import { createClient } from 'npm:@insforge/sdk';");
  });

  it('does not skip normalization when "module.exports =" only appears in a string literal', async () => {
    const code = `export default async function (req: Request): Promise<Response> {
  const msg = 'module.exports = fake';
  return new Response(msg);
}`;

    const result = normalizeHandlerFormat(code);
    expect(result).toMatch(/^module\.exports = async function/);
    const wrapper = new Function('exports', 'module', result);
    const exportsObj: Record<string, unknown> = {};
    const moduleObj = { exports: exportsObj };
    wrapper(exportsObj, moduleObj);
    const handler = moduleObj.exports as (req: unknown) => Promise<{ text(): Promise<string> }>;
    const response = await handler({});
    expect(await response.text()).toBe('module.exports = fake');
  });

  // Round-3 regression coverage: a third review pass found the masker
  // couldn't tell a regex literal from a string/comment (a quote or `//`
  // inside a regex character class was misread as starting one), and that
  // TypeScript's optional-parameter `?` was never stripped.

  it('does not let a regex literal containing a quote character confuse string detection', () => {
    const code = `const quotes = /['"]/;
export default async function (req: Request): Promise<Response> {
  return new Response(quotes.test("x") ? "yes" : "no");
}`;

    const result = normalizeHandlerFormat(code);
    expect(result).toContain('module.exports = async function');
    const wrapper = new Function('exports', 'module', result);
    const exportsObj: Record<string, unknown> = {};
    const moduleObj = { exports: exportsObj };
    wrapper(exportsObj, moduleObj);
    expect(typeof moduleObj.exports).toBe('function');
  });

  it('does not let a double slash inside a regex character class be read as a line comment', () => {
    const code = `const pattern = /[//]/;
export default async function (req: Request): Promise<Response> {
  return new Response(pattern.source);
}`;

    const result = normalizeHandlerFormat(code);
    expect(result).toContain('module.exports = async function');
    const wrapper = new Function('exports', 'module', result);
    const exportsObj: Record<string, unknown> = {};
    const moduleObj = { exports: exportsObj };
    wrapper(exportsObj, moduleObj);
    expect(typeof moduleObj.exports).toBe('function');
  });

  it('does not mistake a division for a regex literal', () => {
    const code = `const half = 10 / 2;
export default async function (req: Request): Promise<Response> {
  return new Response(String(half));
}`;

    const result = normalizeHandlerFormat(code);
    expect(result).toContain('const half = 10 / 2;');
    // Not just a string check: a misidentified regex here would have masked
    // through to (and hidden) the `export default` below it, so the handler
    // must also still actually be there and compilable.
    const wrapper = new Function('exports', 'module', result);
    const exportsObj: Record<string, unknown> = {};
    const moduleObj = { exports: exportsObj };
    wrapper(exportsObj, moduleObj);
    expect(typeof moduleObj.exports).toBe('function');
  });

  it('strips a TypeScript optional-parameter marker', () => {
    const code = `export default async function (req?: Request): Promise<Response> {
  return new Response("hi");
}`;

    const result = normalizeHandlerFormat(code);
    expect(result).not.toMatch(/\?/);
    const wrapper = new Function('exports', 'module', result);
    const exportsObj: Record<string, unknown> = {};
    const moduleObj = { exports: exportsObj };
    wrapper(exportsObj, moduleObj);
    expect(typeof moduleObj.exports).toBe('function');
  });

  it('strips an optional parameter alongside a typed, required one', () => {
    const code = `export default async function (req: Request, opts?: Record<string, string>): Promise<Response> {
  return new Response("hi");
}`;

    const result = normalizeHandlerFormat(code);
    const wrapper = new Function('exports', 'module', result);
    const exportsObj: Record<string, unknown> = {};
    const moduleObj = { exports: exportsObj };
    wrapper(exportsObj, moduleObj);
    expect(typeof moduleObj.exports).toBe('function');
  });

  // Round-4 regression coverage: a fourth review pass found a keyword before
  // a regex literal (`return /.../`) still misclassified, a return type
  // separated from `)` by a line break not stripped, a comment inside an
  // import's brace list defeating the known-binding check, an unbalanced
  // relational operator in one parameter's default value corrupting a
  // *later* parameter's type, and an export-default handler whose body
  // happens to contain a `module.exports =`-shaped line being misread as
  // the legacy format.

  it('recognizes a regex literal immediately after the "return" keyword', () => {
    const code = `function helper() { return /'foo/; }
export default async function (req: Request): Promise<Response> {
  return new Response(String(helper()));
}`;

    const result = normalizeHandlerFormat(code);
    expect(result).toContain('module.exports = async function');
    const wrapper = new Function('exports', 'module', result);
    const exportsObj: Record<string, unknown> = {};
    const moduleObj = { exports: exportsObj };
    wrapper(exportsObj, moduleObj);
    expect(typeof moduleObj.exports).toBe('function');
  });

  it('strips a return type separated from the parameter list by a line break', () => {
    const code = `export default async function (req: Request)
  : Promise<Response> {
  return new Response("hi");
}`;

    const result = normalizeHandlerFormat(code);
    expect(result).not.toMatch(/Promise</);
    const wrapper = new Function('exports', 'module', result);
    const exportsObj: Record<string, unknown> = {};
    const moduleObj = { exports: exportsObj };
    wrapper(exportsObj, moduleObj);
    expect(typeof moduleObj.exports).toBe('function');
  });

  it('resolves a known import even with a comment inside its brace list', async () => {
    const code = `import { createClient /* the sdk client */ } from 'npm:@insforge/sdk';

export default async function (req: Request): Promise<Response> {
  const client = createClient({});
  return new Response(typeof client);
}`;

    const result = normalizeHandlerFormat(code);
    expect(result).not.toMatch(/\bimport\b/);

    const wrapper = new Function('exports', 'module', 'createClient', result);
    const exportsObj: Record<string, unknown> = {};
    const moduleObj = { exports: exportsObj };
    wrapper(exportsObj, moduleObj, () => ({}));
    const handler = moduleObj.exports as (req: unknown) => Promise<{ text(): Promise<string> }>;
    const response = await handler({});
    expect(await response.text()).toBe('object');
  });

  it('does not let an unbalanced relational operator in one default value corrupt a later parameter', () => {
    const code = `export default async function (a = 1 < 2, b: Request): Promise<Response> {
  return new Response("hi");
}`;

    const result = normalizeHandlerFormat(code);
    expect(result).not.toMatch(/:\s*Request/);
    const wrapper = new Function('exports', 'module', result);
    const exportsObj: Record<string, unknown> = {};
    const moduleObj = { exports: exportsObj };
    wrapper(exportsObj, moduleObj);
    expect(typeof moduleObj.exports).toBe('function');
  });

  it('does not let a ternary in an untyped default value corrupt a later parameter', async () => {
    // `a` has no type annotation at all here, so the only way into 'default'
    // mode is seeing a bare '=' straight from 'name' mode — without that,
    // the ternary's own ':' below is misread as starting a type annotation.
    const code = `export default async function (a = 1 < 2 ? "x" : "y", b: Request): Promise<Response> {
  return new Response(a);
}`;

    const result = normalizeHandlerFormat(code);
    expect(result).toContain('1 < 2 ? "x" : "y"');
    expect(result).not.toMatch(/b:\s*Request/);
    const wrapper = new Function('exports', 'module', result);
    const exportsObj: Record<string, unknown> = {};
    const moduleObj = { exports: exportsObj };
    wrapper(exportsObj, moduleObj);
    const handler = moduleObj.exports as (
      a: string,
      req: unknown
    ) => Promise<{ text(): Promise<string> }>;
    const response = await handler(undefined as never, {});
    expect(await response.text()).toBe('x'); // 1 < 2 is true
  });

  it('rewrites export default even when a comment in the body looks like a legacy assignment', () => {
    const code = `export default async function (req: Request): Promise<Response> {
  // module.exports = something (just a comment, not a real assignment)
  return new Response("hi");
}`;

    const result = normalizeHandlerFormat(code);
    expect(result).not.toMatch(/export\s+default/);
    expect(result).toMatch(/^module\.exports = async function/);
    const wrapper = new Function('exports', 'module', result);
    const exportsObj: Record<string, unknown> = {};
    const moduleObj = { exports: exportsObj };
    wrapper(exportsObj, moduleObj);
    expect(typeof moduleObj.exports).toBe('function');
  });

  // Round-5 regression coverage: a fifth review pass found that `//` was
  // reaching the regex-literal scanner before the comment handler ever got
  // a chance to run (an empty regex literal isn't valid JS grammar, but the
  // scanner didn't know that), and that a property merely *named* after a
  // regex-permitting keyword (`obj.delete`, `obj.new`) was still treated as
  // that keyword instead of as the value it actually is.

  it('does not let a line comment be misread as an empty regex literal, hiding its content', () => {
    // Before the fix, `//` was masked as if it were a 2-character regex
    // literal, then the runtime lost track of being inside a comment at
    // all — leaving the rest of the line, including this fake assignment
    // text, unmasked and visible to LEGACY_ASSIGNMENT_PATTERN.
    const code = `// module.exports = fake
export default async function (req: Request): Promise<Response> {
  return new Response("hi");
}`;

    const result = normalizeHandlerFormat(code);
    expect(result).not.toMatch(/^module\.exports = fake/m);
    const wrapper = new Function('exports', 'module', result);
    const exportsObj: Record<string, unknown> = {};
    const moduleObj = { exports: exportsObj };
    wrapper(exportsObj, moduleObj);
    expect(typeof moduleObj.exports).toBe('function');
  });

  it('does not let a comment containing "export default" become a second, malformed rewrite target', () => {
    const code = `// export default fake_thing
export default async function (req: Request): Promise<Response> {
  return new Response("hi");
}`;

    const result = normalizeHandlerFormat(code);
    // The comment's fake "export default" must not be the one rewritten —
    // only the real handler below it.
    expect(result).toMatch(/\/\/ export default fake_thing/);
    const wrapper = new Function('exports', 'module', result);
    const exportsObj: Record<string, unknown> = {};
    const moduleObj = { exports: exportsObj };
    wrapper(exportsObj, moduleObj);
    expect(typeof moduleObj.exports).toBe('function');
  });

  it('does not let a block comment containing fake code reach the rewrite', () => {
    const code = `/* module.exports = fake; export default fake2; */
export default async function (req: Request): Promise<Response> {
  return new Response("hi");
}`;

    const result = normalizeHandlerFormat(code);
    const wrapper = new Function('exports', 'module', result);
    const exportsObj: Record<string, unknown> = {};
    const moduleObj = { exports: exportsObj };
    wrapper(exportsObj, moduleObj);
    expect(typeof moduleObj.exports).toBe('function');
  });

  it('treats a property named after a regex-permitting keyword as a value, not the keyword', () => {
    const code = `const stats = { delete: 10 };
const ratio = stats.delete / 2;
export default async function (req: Request): Promise<Response> {
  return new Response(String(ratio));
}`;

    const result = normalizeHandlerFormat(code);
    expect(result).toContain('const ratio = stats.delete / 2;');
    const wrapper = new Function('exports', 'module', result);
    const exportsObj: Record<string, unknown> = {};
    const moduleObj = { exports: exportsObj };
    wrapper(exportsObj, moduleObj);
    expect(typeof moduleObj.exports).toBe('function');
  });

  it('still strips a later typed parameter after a division on a keyword-named property', () => {
    const code = `const stats = { new: 10, total: 20 };
const ratio = stats.new / stats.total;
export default async function (req: Request, opts: Record<string, string>): Promise<Response> {
  return new Response(String(ratio));
}`;

    const result = normalizeHandlerFormat(code);
    expect(result).not.toMatch(/opts:\s*Record/);
    const wrapper = new Function('exports', 'module', result);
    const exportsObj: Record<string, unknown> = {};
    const moduleObj = { exports: exportsObj };
    wrapper(exportsObj, moduleObj);
    expect(typeof moduleObj.exports).toBe('function');
  });
});

describe('functions/handler-format.js — Zeabur embedded copy stays in sync', () => {
  // deploy/zeabur/template.yml inlines a standalone copy of this file for
  // its embedded Deno runtime (that deployment target can't read a second
  // local file at request time the way the other deploy targets do). A
  // reviewer flagged that the two copies will silently drift if one is
  // edited without the other — this test makes that impossible to miss.
  it('embeds byte-identical content to functions/handler-format.js', () => {
    // Plain string extraction rather than a real YAML parser: this only
    // needs to locate one known block-scalar entry (by its fixed `- path:`
    // marker and indentation) and dedent it — pulling in a YAML dependency
    // for that would be more machinery than the check warrants.
    const realSource = readFileSync(
      join(__dirname, '../../../functions/handler-format.js'),
      'utf-8'
    );
    const templatePath = join(__dirname, '../../../deploy/zeabur/template.yml');
    // Normalized once here (rather than only at the final comparison) so the
    // marker/slice logic below doesn't have to account for a CRLF checkout.
    const templateSource = readFileSync(templatePath, 'utf-8').replace(/\r\n/g, '\n');

    const startMarker =
      '                - path: /app/functions/handler-format.js\n                  template: |\n';
    const startIndex = templateSource.indexOf(startMarker);
    expect(
      startIndex,
      'deploy/zeabur/template.yml is missing the handler-format.js config entry'
    ).toBeGreaterThanOrEqual(0);

    const contentStart = startIndex + startMarker.length;
    const endMarker = '\n            healthCheck:';
    const endIndex = templateSource.indexOf(endMarker, contentStart);
    expect(
      endIndex,
      'could not find the end of the embedded handler-format.js block'
    ).toBeGreaterThan(contentStart);

    const indent = '                    ';
    const dedented = templateSource
      .slice(contentStart, endIndex)
      .split('\n')
      .map((line) => (line.startsWith(indent) ? line.slice(indent.length) : line))
      .join('\n');

    // Trailing-newline-insensitive: the embedded copy's block ends at the
    // last content line (nothing meaningful follows it before `healthCheck:`
    // in the YAML), while the real file ends with the newline every text
    // file has — not a real difference worth failing this test over.
    expect(dedented.replace(/\n$/, '')).toBe(realSource.replace(/\r\n/g, '\n').replace(/\n$/, ''));
  });
});
