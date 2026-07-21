import express from 'express';
import request from 'supertest';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ERROR_CODES } from '@insforge/shared-schemas';
import { AppError } from '../../src/utils/errors.js';
import { errorMiddleware } from '../../src/api/middlewares/error.js';

const chatServiceMock = vi.hoisted(() => ({ streamChat: vi.fn(), chat: vi.fn() }));

vi.hoisted(() => {
  process.env.JWT_SECRET = 'test-secret-long-enough-for-signing-32chars';
});

vi.mock('../../src/utils/environment.js', () => ({
  isCloudEnvironment: () => false,
}));

vi.mock('../../src/api/middlewares/auth.js', () => ({
  verifyAdmin: (req: { user?: { id: string } }, _res: unknown, next: () => void) => {
    req.user = { id: 'admin-1' };
    next();
  },
  verifyUser: (_req: unknown, _res: unknown, next: () => void) => next(),
}));

vi.mock('../../src/services/ai/chat-completion.service.js', () => ({
  ChatCompletionService: { getInstance: () => chatServiceMock },
}));

vi.mock('../../src/services/ai/image-generation.service.js', () => ({
  ImageGenerationService: { getInstance: () => ({}) },
}));

vi.mock('../../src/services/ai/embedding.service.js', () => ({
  EmbeddingService: { getInstance: () => ({}) },
}));

vi.mock('../../src/providers/ai/openrouter.provider.js', () => ({
  OpenRouterProvider: { getInstance: () => ({}) },
}));

vi.mock('../../src/services/ai/model-gateway-config.service.js', () => ({
  ModelGatewayConfigService: { getInstance: () => ({}) },
  ModelGatewayConfigUpdateError: class extends Error {},
}));

vi.mock('../../src/services/logs/audit.service.js', () => ({
  AuditService: { getInstance: () => ({ log: vi.fn() }) },
}));

vi.mock('../../src/utils/logger.js', () => ({
  default: { info: vi.fn(), error: vi.fn(), warn: vi.fn(), debug: vi.fn() },
  logger: { info: vi.fn(), error: vi.fn(), warn: vi.fn(), debug: vi.fn() },
}));

// Mount the real production error middleware rather than a stand-in, so these
// tests assert the actual error-response contract clients receive
// ({ error, message, statusCode }) and not a shape invented by the test.
async function createApp() {
  const { aiRouter } = await import('../../src/api/routes/ai/index.routes.js');
  const app = express();
  app.use(express.json());
  app.use('/api/ai', aiRouter);
  app.use(errorMiddleware);
  return app;
}

const streamingRequest = {
  model: 'openai/gpt-4o',
  messages: [{ role: 'user', content: 'Hello' }],
  stream: true,
};

// Mirrors the real service: the upstream request is issued when the generator is
// first advanced, so the failure surfaces before any byte is streamed. The
// trailing `yield` is unreachable and exists only to satisfy `require-yield`.
function failsOnFirstPull(error: unknown) {
  return async function* (): AsyncGenerator<Record<string, unknown>> {
    await Promise.resolve();
    throw error;
    yield {};
  };
}

describe('POST /api/ai/chat/completion - streaming error status', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // NOTE: no vi.resetModules() here. The route resolves AppError through the
    // same module instance this file imports, and resetting the registry between
    // the two would hand the router a second AppError class, breaking the
    // `instanceof` check the handler relies on.
  });

  it('surfaces the mapped upstream status when the stream fails before any chunk', async () => {
    // The upstream call happens on the first pull of the generator, so an
    // out-of-credits failure surfaces before a single byte is streamed.
    chatServiceMock.streamChat.mockImplementation(
      failsOnFirstPull(
        new AppError('AI credit limit reached.', 402, ERROR_CODES.BILLING_INSUFFICIENT_BALANCE)
      )
    );

    const response = await request(await createApp())
      .post('/api/ai/chat/completion')
      .send(streamingRequest);

    // Regression guard: this used to flush a 200 with an SSE error frame, so a
    // client checking `response.ok` read a billing failure as success.
    expect(response.status).toBe(402);
    expect(response.body.error).toBe(ERROR_CODES.BILLING_INSUFFICIENT_BALANCE);
    expect(response.body.statusCode).toBe(402);
    expect(response.headers['content-type']).toContain('application/json');
    expect(response.text).not.toContain('data: ');
  });

  it('maps a rate-limit failure to 429 rather than 200', async () => {
    chatServiceMock.streamChat.mockImplementation(
      failsOnFirstPull(
        new AppError('AI provider rate limit exceeded.', 429, ERROR_CODES.RATE_LIMITED)
      )
    );

    const response = await request(await createApp())
      .post('/api/ai/chat/completion')
      .send(streamingRequest);

    expect(response.status).toBe(429);
    expect(response.body.error).toBe(ERROR_CODES.RATE_LIMITED);
    expect(response.body.statusCode).toBe(429);
  });

  it('falls back to 500 for a non-AppError failure before streaming starts', async () => {
    chatServiceMock.streamChat.mockImplementation(failsOnFirstPull(new Error('socket hang up')));

    const response = await request(await createApp())
      .post('/api/ai/chat/completion')
      .send(streamingRequest);

    expect(response.status).toBe(500);
    expect(response.body.error).toBe(ERROR_CODES.INTERNAL_ERROR);
    expect(response.body.message).toBe('socket hang up');
  });

  it('keeps reporting mid-stream failures in-band once headers are flushed', async () => {
    // Once a chunk has been written the status line is already committed, so the
    // failure must still be reported as an SSE frame on the open 200 response.
    chatServiceMock.streamChat.mockImplementation(async function* () {
      yield { chunk: 'Hello' };
      throw new AppError('AI provider rate limit exceeded.', 429, ERROR_CODES.RATE_LIMITED);
    });

    const response = await request(await createApp())
      .post('/api/ai/chat/completion')
      .send(streamingRequest);

    expect(response.status).toBe(200);
    expect(response.headers['content-type']).toContain('text/event-stream');
    expect(response.text).toContain('"chunk":"Hello"');
    expect(response.text).toContain('"error":true');
  });
});
