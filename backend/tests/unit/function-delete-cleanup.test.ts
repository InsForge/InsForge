import { beforeEach, describe, expect, it, vi } from 'vitest';
import { FunctionService } from '../../src/services/functions/function.service.js';

const mockPool = {
  query: vi.fn(),
  connect: vi.fn(),
};

vi.mock('../../src/infra/database/database.manager.js', () => ({
  DatabaseManager: {
    getInstance: () => ({
      getPool: () => mockPool,
    }),
  },
}));

vi.mock('../../src/providers/functions/deno-subhosting.provider.js', () => ({
  DenoSubhostingProvider: {
    getInstance: () => ({
      isConfigured: vi.fn().mockReturnValue(false),
    }),
  },
}));

vi.mock('../../src/services/secrets/secret.service.js', () => ({
  SecretService: {
    getInstance: () => ({}),
  },
}));

vi.mock('../../src/utils/logger.js', () => ({
  default: {
    info: vi.fn(),
    error: vi.fn(),
    warn: vi.fn(),
    debug: vi.fn(),
  },
}));

describe('FunctionService.deleteFunction — deployment cleanup', () => {
  let service: FunctionService;

  beforeEach(() => {
    vi.clearAllMocks();
    service = FunctionService.getInstance();
  });

  it('deletes associated deployment records when function is deleted', async () => {
    mockPool.query
      .mockResolvedValueOnce({ rowCount: 1 }) // DELETE FROM functions.definitions
      .mockResolvedValueOnce({ rowCount: 2 }); // DELETE FROM functions.deployments

    const result = await service.deleteFunction('my-func');

    expect(result).toBe(true);
    expect(mockPool.query).toHaveBeenCalledTimes(2);
    expect(mockPool.query).toHaveBeenNthCalledWith(
      2,
      'DELETE FROM functions.deployments WHERE functions @> $1::jsonb',
      [JSON.stringify(['my-func'])]
    );
  });

  it('does not clean up deployments if function not found', async () => {
    mockPool.query.mockResolvedValueOnce({ rowCount: 0 }); // DELETE FROM functions.definitions

    const result = await service.deleteFunction('nonexistent');

    expect(result).toBe(false);
    expect(mockPool.query).toHaveBeenCalledTimes(1);
  });

  it('still triggers redeployment after cleanup', async () => {
    mockPool.query
      .mockResolvedValueOnce({ rowCount: 1 }) // DELETE FROM functions.definitions
      .mockResolvedValueOnce({ rowCount: 0 }); // DELETE FROM functions.deployments (none matched)

    const scheduleSpy = vi.spyOn(service as never, 'scheduleDeployment' as never);

    await service.deleteFunction('my-func');

    expect(scheduleSpy).toHaveBeenCalledTimes(1);
  });
});
