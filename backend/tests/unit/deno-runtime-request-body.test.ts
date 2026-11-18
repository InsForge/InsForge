import { readFileSync } from 'node:fs';
import { setTimeout as delay } from 'node:timers/promises';
import { runInNewContext } from 'node:vm';
import { resolve } from 'node:path';
import ts from 'typescript';
import { describe, expect, it, vi } from 'vitest';

type ExecuteInWorker = (code: string, request: Request) => Promise<Response>;

type RuntimeContext = {
  __testExecuteInWorker?: ExecuteInWorker;
};

function loadExecuteInWorker(options: {
  clearTimeout: (timeout: unknown) => void;
  createObjectURL: (object: Blob | MediaSource) => string;
  revokeObjectURL: (url: string) => void;
  terminate: () => void;
  postMessage: () => void;
  timeoutHandle: symbol;
}): ExecuteInWorker {
  const source = readFileSync(resolve(__dirname, '../../../functions/server.ts'), 'utf8')
    .replace(/^import .* from 'https:\/\/deno\.land\/.*';\r?\n/gm, '')
    .replace('import.meta.url', "'file:///app/functions/server.ts'")
    .replace(
      'Deno.serve({ hostname, port }, async (req: Request) => {',
      'globalThis.__testExecuteInWorker = executeInWorker;\n\nDeno.serve({ hostname, port }, async (req: Request) => {'
    );

  const compiled = ts.transpileModule(source, {
    compilerOptions: {
      module: ts.ModuleKind.None,
      target: ts.ScriptTarget.ES2022,
    },
  }).outputText;

  class Client {
    async connect(): Promise<void> {}

    async end(): Promise<void> {}

    async queryObject<T>(): Promise<{ rows: T[] }> {
      return { rows: [] };
    }
  }

  class Worker {
    onmessage: ((event: MessageEvent) => void) | null = null;
    onerror: ((event: ErrorEvent) => void) | null = null;

    postMessage = options.postMessage;
    terminate = options.terminate;
  }

  class RuntimeURL extends URL {
    static createObjectURL(object: Blob | MediaSource): string {
      return options.createObjectURL(object) as string;
    }

    static revokeObjectURL(url: string): void {
      options.revokeObjectURL(url);
    }
  }

  const context: RuntimeContext & Record<string, unknown> = {
    Blob,
    Client,
    Deno: {
      env: {
        get(key: string) {
          return key === 'WORKER_TIMEOUT_MS' ? '60000' : undefined;
        },
      },
      readTextFile: vi.fn().mockResolvedValue(''),
      serve: vi.fn(),
      version: { deno: 'test', typescript: 'test', v8: 'test' },
    },
    Request,
    Response,
    URL: RuntimeURL,
    Worker,
    clearTimeout: options.clearTimeout,
    console: { error: vi.fn(), log: vi.fn(), warn: vi.fn() },
    dirname: vi.fn().mockReturnValue('/app/functions'),
    fromFileUrl: vi.fn().mockReturnValue('/app/functions/server.ts'),
    join: vi.fn().mockReturnValue('/app/functions/worker-template.js'),
    setTimeout: vi.fn().mockReturnValue(options.timeoutHandle),
  };
  runInNewContext(compiled, context);

  if (!context.__testExecuteInWorker) {
    throw new Error('Deno runtime did not expose executeInWorker');
  }

  return context.__testExecuteInWorker;
}

describe('Deno runtime request body handling', () => {
  it('cleans up and returns a generic 400 when reading a request body fails', async () => {
    const timeoutHandle = Symbol('worker-timeout');
    const clearTimeoutMock = vi.fn();
    const createObjectURLMock = vi.fn().mockReturnValue('blob:worker');
    const revokeObjectURLMock = vi.fn();
    const terminateMock = vi.fn();
    const postMessageMock = vi.fn();
    const executeInWorker = loadExecuteInWorker({
      clearTimeout: clearTimeoutMock,
      createObjectURL: createObjectURLMock,
      revokeObjectURL: revokeObjectURLMock,
      terminate: terminateMock,
      postMessage: postMessageMock,
      timeoutHandle,
    });
    const internalError = new Error('internal stream failure');
    const request = new Request('http://functions.example/issue-2055-abort', {
      method: 'POST',
      body: new ReadableStream<Uint8Array>({
        start(controller) {
          controller.error(internalError);
        },
      }),
      duplex: 'half',
    } as RequestInit);
    const unhandledRejections: unknown[] = [];
    const onUnhandledRejection = (reason: unknown) => {
      unhandledRejections.push(reason);
    };

    process.on('unhandledRejection', onUnhandledRejection);
    try {
      const response = await Promise.race([
        executeInWorker('export default () => new Response("ok")', request),
        delay(1000).then(() => {
          throw new Error('executeInWorker did not resolve promptly');
        }),
      ]);
      const responseBody = await response.text();

      expect(response.status).toBe(400);
      expect(JSON.parse(responseBody)).toEqual({ error: 'Invalid request body' });
      expect(responseBody).not.toContain(internalError.message);
      expect(postMessageMock).not.toHaveBeenCalled();
      expect(clearTimeoutMock).toHaveBeenCalledWith(timeoutHandle);
      expect(terminateMock).toHaveBeenCalledTimes(1);
      expect(revokeObjectURLMock).toHaveBeenCalledTimes(1);
      expect(revokeObjectURLMock).toHaveBeenCalledWith('blob:worker');

      await new Promise<void>((resolve) => setImmediate(resolve));
      expect(unhandledRejections).toEqual([]);
    } finally {
      process.off('unhandledRejection', onUnhandledRejection);
    }
  });
});
