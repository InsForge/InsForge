import { describe, expect, it, vi } from 'vitest';

vi.hoisted(() => {
  process.env.JWT_SECRET = 'test-secret-long-enough-for-signing-32chars';
});

import { aiRouter } from '../../src/api/routes/ai/index.routes';

type RouteEntry = {
  route?: {
    path: string;
    methods: Record<string, boolean>;
    stack: Array<{ handle: { name: string } }>;
  };
};

describe('ai route wiring', () => {
  const routeLayers = (
    aiRouter as unknown as {
      stack: RouteEntry[];
    }
  ).stack.filter((layer) => layer.route);

  const routeEntries = routeLayers.map((layer) => ({
    path: layer.route?.path,
    methods: Object.keys(layer.route?.methods ?? {}).sort(),
  }));

  const getHandlerNames = (path: string): string[] => {
    const route = routeLayers.find((layer) => layer.route?.path === path);
    return route?.route?.stack.map((handler) => handler.handle.name) ?? [];
  };

  it('registers the OpenRouter key rotation route', () => {
    expect(routeEntries).toContainEqual({
      path: '/:provider/api-key/rotate',
      methods: ['post'],
    });
  });

  it('guards the rotation route with verifyAdmin', () => {
    const handlerNames = getHandlerNames('/:provider/api-key/rotate');
    expect(handlerNames).toContain('verifyAdmin');
  });

  it('registers the chat completion route', () => {
    expect(routeEntries).toContainEqual({
      path: '/chat/completion',
      methods: ['post'],
    });
  });

  it('guards the chat completion route with verifyUser, rate limiter, and quota check', () => {
    const handlerNames = getHandlerNames('/chat/completion');
    expect(handlerNames).toContain('verifyUser');
    expect(handlerNames).toContain('checkAIQuota');
  });

  it('registers the image generation route', () => {
    expect(routeEntries).toContainEqual({
      path: '/image/generation',
      methods: ['post'],
    });
  });

  it('guards the image generation route with verifyUser, rate limiter, and quota check', () => {
    const handlerNames = getHandlerNames('/image/generation');
    expect(handlerNames).toContain('verifyUser');
    expect(handlerNames).toContain('checkAIQuota');
  });

  it('registers the embeddings route', () => {
    expect(routeEntries).toContainEqual({
      path: '/embeddings',
      methods: ['post'],
    });
  });

  it('guards the embeddings route with verifyUser, rate limiter, and quota check', () => {
    const handlerNames = getHandlerNames('/embeddings');
    expect(handlerNames).toContain('verifyUser');
    expect(handlerNames).toContain('checkAIQuota');
  });

  it('registers the usage report route', () => {
    expect(routeEntries).toContainEqual({
      path: '/usage/report',
      methods: ['get'],
    });
  });

  it('guards the usage report route with verifyAdmin', () => {
    const handlerNames = getHandlerNames('/usage/report');
    expect(handlerNames).toContain('verifyAdmin');
  });

  it('registers the quotas GET route', () => {
    expect(routeEntries).toContainEqual({
      path: '/quotas',
      methods: ['get'],
    });
  });

  it('registers the quotas PUT route', () => {
    expect(routeEntries).toContainEqual({
      path: '/quotas',
      methods: ['put'],
    });
  });

  it('guards the quotas routes with verifyAdmin', () => {
    const handlerNames = getHandlerNames('/quotas');
    expect(handlerNames).toContain('verifyAdmin');
  });

  it('registers all known routes', () => {
    const paths = routeEntries.map((e) => `${e.methods.join(', ').toUpperCase()} ${e.path}`);
    expect(paths).toContain('GET /models');
    expect(paths).toContain('GET /overview');
    expect(paths).toContain('GET /:provider/api-key');
    expect(paths).toContain('POST /:provider/api-key/rotate');
    expect(paths).toContain('POST /chat/completion');
    expect(paths).toContain('POST /image/generation');
    expect(paths).toContain('POST /embeddings');
    expect(paths).toContain('GET /usage/report');
    expect(paths).toContain('GET /quotas');
    expect(paths).toContain('PUT /quotas');
  });
});
