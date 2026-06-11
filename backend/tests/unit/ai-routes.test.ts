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

  it('registers the OpenRouter key rotation route', () => {
    expect(routeEntries).toContainEqual({
      path: '/:provider/api-key/rotate',
      methods: ['post'],
    });
  });

  it('guards the rotation route with verifyAdmin', () => {
    const rotateRoute = routeLayers.find(
      (layer) => layer.route?.path === '/:provider/api-key/rotate'
    );

    const handlerNames = rotateRoute?.route?.stack.map((handler) => handler.handle.name) ?? [];
    expect(handlerNames).toContain('verifyAdmin');
  });
});
