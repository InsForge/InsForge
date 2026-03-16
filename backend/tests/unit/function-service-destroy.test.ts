import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock dependencies that FunctionService pulls in at import time
vi.mock('../../src/infra/database/database.manager', () => ({
  DatabaseManager: {
    getInstance: vi.fn(() => ({ getPool: vi.fn() })),
  },
}));
vi.mock('../../src/utils/logger', () => ({
  default: { info: vi.fn(), error: vi.fn(), warn: vi.fn(), debug: vi.fn() },
}));
vi.mock('../../src/providers/functions/deno-subhosting.provider', () => ({
  DenoSubhostingProvider: { getInstance: vi.fn(() => ({})) },
}));
vi.mock('../../src/services/secrets/secret.service', () => ({
  SecretService: { getInstance: vi.fn(() => ({})) },
}));

import { FunctionService } from '../../src/services/functions/function.service';

describe('FunctionService.destroy()', () => {
  beforeEach(() => {
    // Reset singleton between tests
    // @ts-expect-error accessing private static for test isolation
    FunctionService.instance = undefined;
  });

  it('clears a pending deploymentTimer and sets it to null', () => {
    const service = FunctionService.getInstance();
    const fakeTimer = setTimeout(() => {}, 60_000);

    // Inject a timer directly into the private field
    // @ts-expect-error accessing private for testing
    service.deploymentTimer = fakeTimer;

    const clearSpy = vi.spyOn(globalThis, 'clearTimeout');
    service.destroy();

    expect(clearSpy).toHaveBeenCalledWith(fakeTimer);
    // @ts-expect-error accessing private for testing
    expect(service.deploymentTimer).toBeNull();
  });

  it('does nothing when there is no pending timer', () => {
    const service = FunctionService.getInstance();
    const clearSpy = vi.spyOn(globalThis, 'clearTimeout');

    service.destroy(); // should not throw

    expect(clearSpy).not.toHaveBeenCalled();
  });
});
