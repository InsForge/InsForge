import { AsyncLocalStorage } from 'node:async_hooks';
import { runInNewContext } from 'node:vm';
import { randomUUID } from 'node:crypto';
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

function executeGeneratedRouter(
  functions: FunctionDefinition[],
  handler: (request: Request) => Promise<Response> = async () => new Response('ok')
): { dispatch: Dispatch; logs: string[] } {
  const provider = DenoSubhostingProvider.getInstance() as unknown as RouterGenerator;
  const generatedRouter = provider
    .generateRouter(functions)
    .replace(
      "import { AsyncLocalStorage } from 'node:async_hooks';",
      'const { AsyncLocalStorage } = globalThis.__testRuntime__;'
    )
    .replace(
      /import (_[A-Za-z0-9_]+) from "\.\/functions\/[^"]+";/g,
      'const $1 = globalThis.__testHandler__;'
    )
    .replace('export {};', '');

  let dispatch: Dispatch | undefined;
  const logs: string[] = [];
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
    Headers,
    crypto: { randomUUID },
    console: { log: (line: string) => logs.push(line) },
    __testHandler__: handler,
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

  return { dispatch, logs };
}

describe('generated Deno Subhosting router', () => {
  it('does not disclose deployed slugs in an unknown-function response', async () => {
    const { dispatch } = executeGeneratedRouter([
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
    const { dispatch } = executeGeneratedRouter([
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
    const { dispatch } = executeGeneratedRouter([]);

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

  it('records safe invocation metadata and propagates a server-generated request ID', async () => {
    let receivedRequest: Request | undefined;
    const { dispatch, logs } = executeGeneratedRouter(
      [{ slug: 'orders', code: 'export default async () => new Response("ok")' }],
      async (request) => {
        receivedRequest = request;
        return new Response('ok', {
          status: 201,
          headers: { 'content-type': 'text/plain; charset=utf-8' },
        });
      }
    );

    const response = await dispatch(
      new Request('https://functions.example/orders?token=top-secret', {
        method: 'POST',
        headers: {
          authorization: 'Bearer top-secret',
          'content-type': 'application/json; token=top-secret',
          'x-insforge-request-id': 'client-forged',
        },
        body: '{"password":"top-secret"}',
      })
    );

    expect(response.status).toBe(201);
    expect(logs).toHaveLength(1);
    const invocation = JSON.parse(logs[0]) as Record<string, unknown>;
    expect(invocation).toMatchObject({
      event: 'function.invocation',
      level: 'info',
      slug: 'orders',
      method: 'POST',
      status: 201,
      request: { contentType: 'application/json' },
      response: { contentType: 'text/plain' },
    });
    expect(invocation.durationMs).toEqual(expect.any(Number));
    expect(invocation.requestId).toEqual(expect.any(String));
    expect(invocation.requestId).not.toBe('client-forged');
    expect(receivedRequest?.headers.get('x-insforge-request-id')).toBe(invocation.requestId);
    expect(response.headers.get('x-insforge-request-id')).toBe(invocation.requestId);
    expect(JSON.stringify(invocation)).not.toContain('top-secret');
  });

  it('logs failed invocations without copying error messages into the log', async () => {
    const { dispatch, logs } = executeGeneratedRouter(
      [{ slug: 'orders', code: 'export default async () => new Response("ok")' }],
      async () => {
        throw new Error('secret from upstream');
      }
    );

    const response = await dispatch(new Request('https://functions.example/orders'));
    expect(response.status).toBe(500);
    const invocation = JSON.parse(logs[0]) as Record<string, unknown>;
    expect(invocation).toMatchObject({
      event: 'function.invocation',
      level: 'error',
      status: 500,
      response: { contentType: 'application/json' },
      error: { name: 'Error' },
    });
    expect(JSON.stringify(invocation)).not.toContain('secret from upstream');
  });
});
