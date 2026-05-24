import { describe, expect, it, vi, beforeEach } from 'vitest';
import type { NextFunction, Response } from 'express';

const { searchMock, verifyUserMock } = vi.hoisted(() => ({
  searchMock: vi.fn(),
  verifyUserMock: vi.fn((_req, _res, next) => next()),
}));

vi.mock('../../src/api/middlewares/auth', () => ({
  verifyUser: verifyUserMock,
}));

vi.mock('../../src/services/database/vectorSearch.service', () => ({
  VectorSearchService: {
    getInstance: () => ({
      search: searchMock,
    }),
  },
}));

import { AppError } from '../../src/utils/errors';
import { vectorRouter } from '../../src/api/routes/vector/index.routes';
import { ERROR_CODES } from '@insforge/shared-schemas';

function getSearchHandlers() {
  const layer = (
    vectorRouter as unknown as {
      stack: Array<{
        route?: {
          path: string;
          methods: Record<string, boolean>;
          stack: Array<{ handle: (...args: unknown[]) => unknown }>;
        };
      }>;
    }
  ).stack.find((entry) => entry.route?.path === '/search' && entry.route.methods.post);

  if (!layer?.route) {
    throw new Error('POST /search route was not registered');
  }

  return layer.route.stack.map((entry) => entry.handle);
}

function createResponse() {
  const response = {
    statusCode: undefined as number | undefined,
    body: undefined as unknown,
    status: vi.fn(function status(this: typeof response, statusCode: number) {
      this.statusCode = statusCode;
      return this;
    }),
    json: vi.fn(function json(this: typeof response, body: unknown) {
      this.body = body;
      return this;
    }),
  };

  return response;
}

async function invokeSearchRoute(body: unknown, requestOverrides: Record<string, unknown> = {}) {
  const [authHandler, routeHandler] = getSearchHandlers();
  const req = {
    body,
    user: { id: 'user-1', email: 'user@example.com', role: 'authenticated' },
    hasApiKey: false,
    ...requestOverrides,
  };
  const res = createResponse();
  const next = vi.fn() as unknown as NextFunction;

  await authHandler(req, res as unknown as Response, next);
  await routeHandler(req, res as unknown as Response, next);

  return { res, next: next as unknown as ReturnType<typeof vi.fn> };
}

describe('vector search routes', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    verifyUserMock.mockImplementation((_req, _res, next) => next());
  });

  it('registers auth before the POST /search handler', () => {
    const [authHandler, routeHandler] = getSearchHandlers();

    expect(authHandler).toBe(verifyUserMock);
    expect(routeHandler).toBeTypeOf('function');
  });

  it('validates the request body and returns service results', async () => {
    const serviceResult = {
      matches: [],
      count: 0,
      metric: 'cosine' as const,
    };
    searchMock.mockResolvedValueOnce(serviceResult);

    const { res, next } = await invokeSearchRoute({
      table: 'documents',
      column: 'embedding',
      query_vector: [0.1, 0.2, 0.3],
      top_k: 3,
      metric: 'cosine',
      include_vector: false,
    });

    expect(searchMock).toHaveBeenCalledWith(
      {
        table: 'documents',
        column: 'embedding',
        query_vector: [0.1, 0.2, 0.3],
        top_k: 3,
        metric: 'cosine',
        include_vector: false,
      },
      {
        id: 'user-1',
        email: 'user@example.com',
        role: 'authenticated',
      }
    );
    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json).toHaveBeenCalledWith(serviceResult);
    expect(next).not.toHaveBeenCalledWith(expect.any(Error));
  });

  it('uses project admin context when authenticated by API key', async () => {
    const serviceResult = {
      matches: [],
      count: 0,
      metric: 'cosine' as const,
    };
    searchMock.mockResolvedValueOnce(serviceResult);

    const { next } = await invokeSearchRoute(
      {
        table: 'documents',
        column: 'embedding',
        query_vector: [0.1, 0.2, 0.3],
        top_k: 3,
        metric: 'cosine',
        include_vector: false,
      },
      {
        hasApiKey: true,
        user: undefined,
      }
    );

    expect(searchMock).toHaveBeenCalledWith(
      expect.objectContaining({
        table: 'documents',
        column: 'embedding',
        query_vector: [0.1, 0.2, 0.3],
      }),
      { role: 'project_admin' }
    );
    expect(next).not.toHaveBeenCalledWith(expect.any(Error));
  });

  it('passes validation errors to error middleware before calling the service', async () => {
    const { next } = await invokeSearchRoute({
      table: 'documents',
      column: 'embedding',
      query_vector: [],
      top_k: 3,
      metric: 'cosine',
    });

    expect(searchMock).not.toHaveBeenCalled();
    const error = (next as unknown as ReturnType<typeof vi.fn>).mock.calls.find(
      ([arg]) => arg instanceof Error
    )?.[0];
    expect(error).toBeInstanceOf(AppError);
    expect(error).toMatchObject({
      statusCode: 400,
      code: ERROR_CODES.INVALID_INPUT,
    });
  });

  it('passes service errors to error middleware', async () => {
    const serviceError = new AppError('vector column missing', 404, ERROR_CODES.NOT_FOUND);
    searchMock.mockRejectedValueOnce(serviceError);

    const { next } = await invokeSearchRoute({
      table: 'documents',
      column: 'embedding',
      query_vector: [0.1, 0.2, 0.3],
      top_k: 3,
      metric: 'cosine',
      include_vector: false,
    });

    expect(next).toHaveBeenCalledWith(serviceError);
  });
});
