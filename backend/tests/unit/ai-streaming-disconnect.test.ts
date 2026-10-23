import http from 'http';
import express from 'express';
import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * Regression test for issue #1895 (SSE Disconnect Token/Resource Leak): a
 * client disconnecting mid-stream from POST /api/ai/chat/completion used to
 * leave the server-side upstream request running to completion, continuing
 * to consume AI tokens against a socket nobody was reading.
 *
 * The route cancels via an `AbortSignal` passed into `streamChat`, not via
 * calling `.return()` on the generator: a plain async generator suspended
 * awaiting its inner `for await` (waiting on the next upstream chunk, the
 * common case) can't be preempted by `.return()` — verified empirically
 * (see the PR description) that it only takes effect once that pending read
 * settles on its own, by which point the upstream request already ran to
 * completion regardless. The fake upstream below is a real `async
 * function*` — like the production `ChatCompletionService.streamChat` — that
 * reacts to the signal the same way a `fetch`-backed SDK call would, so this
 * exercises the mechanism that actually matters.
 *
 * This spins up a real HTTP server (so the client can actually sever the
 * TCP connection) rather than mocking Express, so the 'close' event fires
 * from a genuine socket teardown, not a simulated one.
 */

vi.hoisted(() => {
  process.env.JWT_SECRET = 'test-secret-long-enough-for-signing-32chars';
});

/**
 * Polls `condition` instead of sleeping a fixed duration before a critical
 * assertion — a fixed delay assumes the server-side 'close' handler always
 * runs within that window, which a slow/loaded CI runner can violate and
 * turn into a flaky false failure.
 */
async function waitFor(condition: () => boolean, timeoutMs = 2000, intervalMs = 5): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (!condition()) {
    if (Date.now() >= deadline) {
      throw new Error(`waitFor: condition not met within ${timeoutMs}ms`);
    }
    await new Promise((resolve) => setTimeout(resolve, intervalMs));
  }
}

vi.mock('../../src/api/middlewares/auth.js', () => ({
  verifyAdmin: (_req: unknown, _res: unknown, next: () => void) => next(),
  verifyUser: (_req: unknown, _res: unknown, next: () => void) => next(),
}));

vi.mock('../../src/utils/logger.js', () => ({
  default: { error: vi.fn(), info: vi.fn(), warn: vi.fn() },
}));

vi.mock('../../src/services/ai/image-generation.service.js', () => ({
  ImageGenerationService: { getInstance: () => ({}) },
}));
vi.mock('../../src/services/ai/embedding.service.js', () => ({
  EmbeddingService: { getInstance: () => ({}) },
}));
vi.mock('../../src/services/ai/ai-model.service.js', () => ({
  AIModelService: { getInstance: () => ({}) },
}));
vi.mock('../../src/providers/ai/openrouter.provider.js', () => ({
  OpenRouterProvider: { getInstance: () => ({}) },
}));

const generatorState = vi.hoisted(() => ({
  sawAbortedSignal: false,
  producedSecondChunk: false,
  finallyRan: false,
}));

let releaseSecondChunk: (() => void) | null = null;

// Stands in for ChatCompletionService.streamChat: an `await` that only
// settles when either a real chunk arrives (`releaseSecondChunk`, standing in
// for the network) or `signal` aborts — the same race a `fetch`/OpenAI SDK
// call under an AbortSignal resolves.
async function* fakeUpstreamStream(signal?: AbortSignal) {
  try {
    yield { chunk: 'first' };

    await new Promise<void>((resolve, reject) => {
      if (signal?.aborted) {
        reject(new DOMException('Aborted', 'AbortError'));
        return;
      }
      const onAbort = () => reject(new DOMException('Aborted', 'AbortError'));
      signal?.addEventListener('abort', onAbort, { once: true });
      releaseSecondChunk = () => {
        signal?.removeEventListener('abort', onAbort);
        resolve();
      };
    });

    generatorState.producedSecondChunk = true;
    yield { chunk: 'second' };
  } catch (error) {
    // Mirrors ChatCompletionService.streamChat's own catch: a deliberate
    // abort ends the generator cleanly rather than surfacing as an error.
    if (!(signal?.aborted && error instanceof DOMException)) {
      throw error;
    }
    generatorState.sawAbortedSignal = true;
  } finally {
    generatorState.finallyRan = true;
  }
}

vi.mock('../../src/services/ai/chat-completion.service.js', () => ({
  ChatCompletionService: {
    getInstance: () => ({
      streamChat: (_messages: unknown, _options: unknown, signal?: AbortSignal) =>
        fakeUpstreamStream(signal),
    }),
  },
}));

describe('POST /api/ai/chat/completion — client disconnect mid-stream', () => {
  beforeEach(() => {
    generatorState.sawAbortedSignal = false;
    generatorState.producedSecondChunk = false;
    generatorState.finallyRan = false;
  });

  it('aborts the in-flight upstream request once the client disconnects', async () => {
    const { aiRouter } = await import('../../src/api/routes/ai/index.routes.js');
    const app = express();
    app.use(express.json());
    app.use('/api/ai', aiRouter);

    const server = http.createServer(app);
    await new Promise<void>((resolve) => server.listen(0, resolve));
    const address = server.address();
    if (!address || typeof address === 'string') {
      throw new Error('Expected a bound TCP address');
    }

    try {
      const body = JSON.stringify({
        model: 'openai/gpt-4o',
        messages: [{ role: 'user', content: 'Hi' }],
        stream: true,
      });

      await new Promise<void>((resolve, reject) => {
        const clientReq = http.request(
          {
            host: '127.0.0.1',
            port: address.port,
            path: '/api/ai/chat/completion',
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'Content-Length': Buffer.byteLength(body),
            },
          },
          (res) => {
            res.on('data', () => {
              // Received the first SSE chunk — sever the connection now,
              // while the fake upstream is suspended awaiting the second
              // chunk (i.e. mid-request, same as a real slow upstream).
              clientReq.destroy();
            });
          }
        );
        clientReq.on('error', () => {
          // Expected: destroying the request surfaces as a socket error on
          // the client side (ECONNRESET or similar) — not a test failure.
          resolve();
        });
        clientReq.on('close', () => resolve());
        clientReq.on('timeout', () => reject(new Error('Request timed out')));
        clientReq.write(body);
        clientReq.end();
      });

      // Let the server-side 'close' listener fire and the abort propagate
      // through the fake upstream's pending await before asserting. Only
      // then release the "real chunk" side of the race — if the route had
      // NOT aborted, this is what would let a real upstream eventually
      // produce the second chunk, so asserting first proves the abort (not
      // this release) is what ended the pending request.
      await waitFor(() => generatorState.sawAbortedSignal && generatorState.finallyRan);
      expect(generatorState.producedSecondChunk).toBe(false);

      releaseSecondChunk?.();
      // Give the (deliberately unresolved-until-now) release a turn to
      // resolve should the abort have failed to win the race, then confirm
      // it still didn't produce a chunk.
      await new Promise((resolve) => setTimeout(resolve, 20));
      expect(generatorState.producedSecondChunk).toBe(false);
    } finally {
      await new Promise((resolve) => server.close(resolve));
    }
  });
});
