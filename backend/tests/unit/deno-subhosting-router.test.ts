import { AsyncLocalStorage } from 'node:async_hooks';
import { runInNewContext } from 'node:vm';
import ts from 'typescript';
import { describe, expect, it } from 'vitest';
import {
  DenoSubhostingProvider,
  type FunctionDefinition,
} from '@/providers/functions/deno-subhosting.provider.js';

type RouterGenerator = {
  generateRouter(functions: FunctionDefinition[]): string;
};

type Dispatch = (request: Request) => Promise<Response>;

function executeGeneratedRouter(functions: FunctionDefinition[]): Dispatch {
  const provider = DenoSubhostingProvider.getInstance() as unknown as RouterGenerator;
  const generatedRouter = provider
    .generateRouter(functions)
    .replace(
      "import { AsyncLocalStorage } from 'node:async_hooks';",
      'const { AsyncLocalStorage } = globalThis.__testRuntime__;'
    )
    .replace(
      /import (_[A-Za-z0-9_]+) from "\.\/functions\/[^"]+";/g,
      'const $1 = async () => new Response("ok");'
    )
    .replace('export {};', '');

  let dispatch: Dispatch | undefined;
  const compiledRouter = ts.transpileModule(generatedRouter, {
    compilerOptions: {
      module: ts.ModuleKind.None,
      target: ts.ScriptTarget.ES2022,
    },
  }).outputText;

  runInNewContext(compiledRouter, {
    URL,
    Request,
    Response,
    __testRuntime__: { AsyncLocalStorage },
    Deno: {
      serve(handler: Dispatch) {
        dispatch = handler;
      },
    },
  });

  if (!dispatch) {
    throw new Error('Generated router did not register a request dispatcher');
  }

  return dispatch;
}

describe('generated Deno Subhosting router', () => {
  it('does not disclose deployed slugs in an unknown-function response', async () => {
    const dispatch = executeGeneratedRouter([
      {
        slug: 'merchant-private-alpha',
        code: 'export default async () => new Response("ok")',
      },
      {
        slug: 'merchant-private-beta',
        code: 'export default async () => new Response("ok")',
      },
    ]);

    const missing = await dispatch(new Request('https://functions.example/not-a-function'));
    expect(missing.status).toBe(404);
    expect(await missing.json()).toEqual({ error: 'Function not found' });
  });

  it('does not disclose deployed slugs in a populated-router health response', async () => {
    const dispatch = executeGeneratedRouter([
      {
        slug: 'merchant-private-alpha',
        code: 'export default async () => new Response("ok")',
      },
      {
        slug: 'merchant-private-beta',
        code: 'export default async () => new Response("ok")',
      },
    ]);

    const health = await dispatch(new Request('https://functions.example/health'));
    expect(health.status).toBe(200);
    expect(await health.json()).toEqual({
      status: 'ok',
      type: 'insforge-functions',
      timestamp: expect.any(String),
    });
  });

  it('keeps the empty-router health payload free of a function inventory', async () => {
    const dispatch = executeGeneratedRouter([]);

    const health = await dispatch(new Request('https://functions.example/health'));
    expect(health.status).toBe(200);
    expect(await health.json()).toEqual({
      status: 'ok',
      type: 'insforge-functions',
      timestamp: expect.any(String),
    });

    const missing = await dispatch(new Request('https://functions.example/not-a-function'));
    expect(missing.status).toBe(404);
    expect(await missing.json()).toEqual({ error: 'No functions deployed' });
  });
});
