import { describe, expect, it, vi } from 'vitest';

vi.hoisted(() => {
  process.env.JWT_SECRET = 'test-secret-long-enough-for-signing-32chars';
});

import { advisorRouter } from '../../src/api/routes/advisor/index.routes.js';

interface ExpressRouteLayer {
  route?: {
    path: string;
    methods: Record<string, boolean>;
    stack: Array<{
      handle: {
        name?: string;
      };
    }>;
  };
}

function getRoute(path: string, method: string) {
  const stack = (advisorRouter as unknown as { stack: ExpressRouteLayer[] }).stack;
  return stack
    .map((layer) => layer.route)
    .find((route) => route?.path === path && route.methods[method]);
}

describe('advisor route wiring', () => {
  it('registers admin-only scan, latest, and issue routes', () => {
    for (const [path, method] of [
      ['/scan', 'post'],
      ['/latest', 'get'],
      ['/issues', 'get'],
    ] as const) {
      const route = getRoute(path, method);

      expect(route).toBeDefined();
      expect(route?.stack.some((layer) => layer.handle.name === 'verifyAdmin')).toBe(true);
    }
  });
});
