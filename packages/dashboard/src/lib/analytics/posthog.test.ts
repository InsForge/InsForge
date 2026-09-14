import { afterEach, describe, expect, it, vi } from 'vitest';

const { init } = vi.hoisted(() => ({ init: vi.fn() }));

vi.mock('posthog-js', () => ({ default: { init } }));
vi.mock('posthog-js/react', () => ({ PostHogProvider: () => null }));

describe('PostHog session replay privacy', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.resetModules();
    init.mockClear();
  });

  it('masks all rendered text and inputs so customer data never leaves the browser', async () => {
    vi.stubEnv('VITE_PUBLIC_POSTHOG_KEY', 'phc_test');

    await import('#lib/analytics/posthog');

    expect(init).toHaveBeenCalledTimes(1);
    const [, options] = init.mock.calls[0];
    expect(options.session_recording).toMatchObject({
      maskTextSelector: '*',
      maskAllInputs: true,
    });
  });

  it('does not initialize PostHog when no key is configured', async () => {
    vi.stubEnv('VITE_PUBLIC_POSTHOG_KEY', '');

    await import('#lib/analytics/posthog');

    expect(init).not.toHaveBeenCalled();
  });
});
