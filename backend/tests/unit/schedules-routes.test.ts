import { describe, expect, it, vi } from 'vitest';

vi.hoisted(() => {
  process.env.JWT_SECRET = 'test-secret-long-enough-for-signing-32chars';
});

import { schedulesRouter } from '../../src/api/routes/schedules/index.routes';

describe('schedules route wiring', () => {
  const routeEntries = (
    schedulesRouter as unknown as {
      stack: Array<{
        route?: {
          path: string;
          methods: Record<string, boolean>;
        };
      }>;
    }
  ).stack
    .filter((layer) => layer.route)
    .map((layer) => ({
      path: layer.route!.path,
      methods: Object.keys(layer.route!.methods).sort(),
    }));

  const routeIndex = (path: string, method: string) =>
    routeEntries.findIndex(
      (entry) => entry.path === path && entry.methods.includes(method.toLowerCase())
    );

  it('registers explicit config routes before dynamic schedule id routes', () => {
    const getConfigIndex = routeIndex('/config', 'get');
    const patchConfigIndex = routeIndex('/config', 'patch');
    const getByIdIndex = routeIndex('/:id', 'get');
    const getLogsIndex = routeIndex('/:id/logs', 'get');
    const patchByIdIndex = routeIndex('/:id', 'patch');
    const deleteByIdIndex = routeIndex('/:id', 'delete');

    expect(getConfigIndex).toBeGreaterThan(-1);
    expect(patchConfigIndex).toBeGreaterThan(-1);
    expect(getByIdIndex).toBeGreaterThan(-1);
    expect(getLogsIndex).toBeGreaterThan(-1);
    expect(patchByIdIndex).toBeGreaterThan(-1);
    expect(deleteByIdIndex).toBeGreaterThan(-1);

    expect(getConfigIndex).toBeLessThan(getByIdIndex);
    expect(patchConfigIndex).toBeLessThan(getByIdIndex);
    expect(getConfigIndex).toBeLessThan(patchByIdIndex);
    expect(patchConfigIndex).toBeLessThan(deleteByIdIndex);
  });
});
