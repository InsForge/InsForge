import { afterEach, describe, expect, it, vi } from 'vitest';

describe('app module', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('stays idle when imported by another module', async () => {
    vi.resetModules();

    const processOnSpy = vi.spyOn(process, 'on');

    await import('../../src/app.js');

    expect(processOnSpy).not.toHaveBeenCalledWith('SIGINT', expect.any(Function));
    expect(processOnSpy).not.toHaveBeenCalledWith('SIGTERM', expect.any(Function));
  });
});
