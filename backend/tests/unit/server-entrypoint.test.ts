import { afterEach, describe, expect, it, vi } from 'vitest';

const createAppMock = vi.hoisted(() => vi.fn());

vi.mock('../../src/app.js', () => ({
  createApp: createAppMock,
}));

describe('server entrypoint', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('stays idle when imported by another module', async () => {
    const processOnSpy = vi.spyOn(process, 'on');

    await import('../../src/server.js');

    expect(createAppMock).not.toHaveBeenCalled();
    expect(processOnSpy).not.toHaveBeenCalledWith('SIGINT', expect.any(Function));
    expect(processOnSpy).not.toHaveBeenCalledWith('SIGTERM', expect.any(Function));
  });
});
