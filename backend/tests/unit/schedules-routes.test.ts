import { describe, expect, it } from 'vitest';
import { readFileSync } from 'fs';
import { resolve } from 'path';

describe('schedules route wiring', () => {
  const schedulesRouteSource = readFileSync(
    resolve(__dirname, '../../src/api/routes/schedules/index.routes.ts'),
    'utf-8'
  );

  it('registers explicit config routes before dynamic schedule id routes', () => {
    const getConfigIndex = schedulesRouteSource.indexOf("router.get('/config'");
    const patchConfigIndex = schedulesRouteSource.indexOf("router.patch('/config'");
    const getByIdIndex = schedulesRouteSource.indexOf("router.get('/:id'");
    const getLogsIndex = schedulesRouteSource.indexOf("router.get('/:id/logs'");
    const patchByIdIndex = schedulesRouteSource.indexOf("router.patch('/:id'");
    const deleteByIdIndex = schedulesRouteSource.indexOf("router.delete('/:id'");

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
