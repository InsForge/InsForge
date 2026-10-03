import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useLayoutEffect } from 'react';

type FlagCallback = (
  flags: string[],
  variants: Record<string, string | boolean>,
  context?: { errorsLoading?: boolean }
) => void;

const mocks = vi.hoisted(() => {
  const flagCallbacks = new Set<FlagCallback>();
  let currentFlags: Record<string, string | boolean> = {};
  let hasLoadedFlags = false;

  const fire = (errorsLoading?: boolean) =>
    [...flagCallbacks].forEach((cb) =>
      cb(Object.keys(currentFlags), currentFlags, { errorsLoading })
    );

  return {
    reset() {
      flagCallbacks.clear();
      currentFlags = {};
      hasLoadedFlags = false;
    },
    setFlags(flags: Record<string, string | boolean>) {
      currentFlags = flags;
      hasLoadedFlags = true;
    },
    fireFlags() {
      fire();
    },
    // posthog-js calls back with errorsLoading when it abandons the request: a timeout, a
    // connection error or a non-200. A quota-limited response is the one that never calls back.
    // It marks flags as loaded first, so a later subscriber is called back straight away.
    fireFlagsError() {
      hasLoadedFlags = true;
      fire(true);
    },
    // The module registers one listener of its own at init, so hooks are counted on top of it.
    subscriberCount() {
      return flagCallbacks.size;
    },
    posthog: {
      init: vi.fn(),
      config: { feature_flag_request_timeout_ms: 3000 },
      getFeatureFlag: vi.fn((key: string) => currentFlags[key]),
      onFeatureFlags: vi.fn((cb: FlagCallback) => {
        flagCallbacks.add(cb);
        // Like posthog-js, call back straight away when flags are already loaded.
        if (hasLoadedFlags) {
          cb(Object.keys(currentFlags), currentFlags, {});
        }
        return () => {
          flagCallbacks.delete(cb);
        };
      }),
      featureFlags: {
        get hasLoadedFlags() {
          return hasLoadedFlags;
        },
      },
    },
  };
});

vi.mock('posthog-js', () => ({
  default: mocks.posthog,
}));

vi.mock('posthog-js/react', () => ({
  PostHogProvider: ({ children }: { children: React.ReactNode }) => children,
}));

describe('feature flag hooks', () => {
  beforeEach(() => {
    vi.resetModules();
    mocks.reset();
    vi.stubEnv('VITE_PUBLIC_POSTHOG_KEY', 'phc_test');
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('useFeatureFlag updates when PostHog fires onFeatureFlags', async () => {
    mocks.setFlags({});
    const { useFeatureFlag } = await import('#lib/analytics/posthog');
    const { result } = renderHook(() => useFeatureFlag('dashboard-v4-experiment'));

    expect(result.current).toBeUndefined();

    act(() => {
      mocks.setFlags({ 'dashboard-v4-experiment': 'd_test' });
      mocks.fireFlags();
    });

    expect(result.current).toBe('d_test');
  });

  it("useFeatureFlag never returns the previous key's value after the key changes", async () => {
    mocks.setFlags({ first: 'a', second: 'b' });
    const { useFeatureFlag } = await import('#lib/analytics/posthog');
    const seen: Array<[string, string | boolean | undefined]> = [];
    const { rerender } = renderHook(
      ({ flag }) => {
        seen.push([flag, useFeatureFlag(flag)]);
      },
      { initialProps: { flag: 'first' } }
    );

    rerender({ flag: 'second' });

    expect(seen.filter(([flag]) => flag === 'second').map(([, value]) => value)).not.toContain('a');
    expect(seen[seen.length - 1]).toEqual(['second', 'b']);
  });

  it('useFeatureFlag unsubscribes on unmount', async () => {
    const { useFeatureFlag } = await import('#lib/analytics/posthog');
    const moduleListeners = mocks.subscriberCount();
    const { unmount } = renderHook(() => useFeatureFlag('dashboard-v4-experiment'));

    expect(mocks.subscriberCount()).toBe(moduleListeners + 1);
    unmount();
    expect(mocks.subscriberCount()).toBe(moduleListeners);
  });

  it('useFeatureFlagsReady flips true after the first flag load', async () => {
    const { useFeatureFlagsReady } = await import('#lib/analytics/posthog');
    const { result } = renderHook(() => useFeatureFlagsReady());

    expect(result.current).toBe(false);

    act(() => {
      mocks.setFlags({ 'dashboard-v4-experiment': 'control' });
      mocks.fireFlags();
    });

    expect(result.current).toBe(true);
  });

  it('useFeatureFlagsReady starts true when flags were already loaded', async () => {
    mocks.setFlags({ 'dashboard-v4-experiment': 'control' });
    const { useFeatureFlagsReady } = await import('#lib/analytics/posthog');
    const { result } = renderHook(() => useFeatureFlagsReady());

    expect(result.current).toBe(true);
  });

  // A quota-limited flags response never reaches onFeatureFlags, so readiness has to time out,
  // but not before PostHog itself would have given up on a slow request.
  it('useFeatureFlagsReady stops waiting only after the PostHog request timeout', async () => {
    const { useFeatureFlagsReady } = await import('#lib/analytics/posthog');
    vi.useFakeTimers();
    try {
      const { result } = renderHook(() => useFeatureFlagsReady());

      // The mocked 3s request timeout plus the 2s margin.
      act(() => {
        vi.advanceTimersByTime(4999);
      });
      expect(result.current).toBe(false);

      act(() => {
        vi.advanceTimersByTime(1);
      });
      expect(result.current).toBe(true);
    } finally {
      vi.useRealTimers();
    }
  });

  // The elapsed wait is the end of waiting, not an answer. Reporting it as `loaded` made every
  // flag read as undefined, which is what a control user reads, so one-shot decisions took the
  // control branch for a D_TEST user whose response was still in flight.
  it('useFeatureFlagsStatus reports an elapsed wait as unavailable, not loaded', async () => {
    const { useFeatureFlagsStatus } = await import('#lib/analytics/posthog');
    vi.useFakeTimers();
    try {
      const { result } = renderHook(() => useFeatureFlagsStatus());

      expect(result.current).toBe('pending');

      act(() => {
        vi.advanceTimersByTime(5000);
      });
      expect(result.current).toBe('unavailable');
    } finally {
      vi.useRealTimers();
    }
  });

  it('useFeatureFlagsStatus upgrades to loaded when a late answer arrives', async () => {
    const { useFeatureFlagsStatus } = await import('#lib/analytics/posthog');
    const moduleListeners = mocks.subscriberCount();
    vi.useFakeTimers();
    try {
      const { result } = renderHook(() => useFeatureFlagsStatus());

      act(() => {
        vi.advanceTimersByTime(5000);
      });
      expect(result.current).toBe('unavailable');

      // Still subscribed, so the answer that was in flight is not thrown away.
      expect(mocks.subscriberCount()).toBe(moduleListeners + 1);
      act(() => {
        mocks.setFlags({ 'dashboard-v4-experiment': 'd_test' });
        mocks.fireFlags();
      });
      expect(result.current).toBe('loaded');
    } finally {
      vi.useRealTimers();
    }
  });

  it('useFeatureFlagsStatus reports a failed request as unavailable', async () => {
    const { useFeatureFlagsStatus } = await import('#lib/analytics/posthog');
    const { result } = renderHook(() => useFeatureFlagsStatus());

    expect(result.current).toBe('pending');

    act(() => {
      mocks.fireFlagsError();
    });

    expect(result.current).toBe('unavailable');
  });

  // PostHog counts a failed request as loaded, so re-subscribing after it calls back straight
  // away with no errorsLoading. That callback is not an answer and must not read as `loaded`.
  it('useFeatureFlagsStatus stays unavailable after a failed request until a real answer', async () => {
    const { useFeatureFlagsStatus } = await import('#lib/analytics/posthog');
    const moduleListeners = mocks.subscriberCount();
    const { result } = renderHook(() => useFeatureFlagsStatus());

    act(() => {
      mocks.fireFlagsError();
    });

    expect(result.current).toBe('unavailable');
    expect(mocks.subscriberCount()).toBe(moduleListeners + 1);

    act(() => {
      mocks.setFlags({ 'dashboard-v4-experiment': 'd_test' });
      mocks.fireFlags();
    });

    expect(result.current).toBe('loaded');
  });

  // An answer that lands while the hook moves from pending to unavailable reaches the new
  // subscription only through its immediate callback, so that callback must not be dropped.
  it('useFeatureFlagsStatus takes an answer replayed on re-subscribe as loaded', async () => {
    const { useFeatureFlagsStatus } = await import('#lib/analytics/posthog');
    vi.useFakeTimers();
    try {
      const { result } = renderHook(() => useFeatureFlagsStatus());

      act(() => {
        mocks.setFlags({ 'dashboard-v4-experiment': 'control' });
        vi.advanceTimersByTime(5000);
      });

      expect(result.current).toBe('loaded');
    } finally {
      vi.useRealTimers();
    }
  });

  // PostHog counts a failed request as loaded, so a status hook that mounts after the failure
  // (a route that renders once auth settles) must still see it as unavailable, not loaded.
  it('useFeatureFlagsStatus mounted after a failed request starts unavailable', async () => {
    const { useFeatureFlagsStatus } = await import('#lib/analytics/posthog');

    mocks.fireFlagsError();
    const { result } = renderHook(() => useFeatureFlagsStatus());

    expect(result.current).toBe('unavailable');

    act(() => {
      mocks.setFlags({ 'dashboard-v4-experiment': 'd_test' });
      mocks.fireFlags();
    });

    expect(result.current).toBe('loaded');
  });

  // A hook that renders as pending can see the request fail before its passive effect
  // subscribes. The immediate callback then replays the failure with no errorsLoading, and it
  // must not read as `loaded`.
  it('useFeatureFlagsStatus treats a failure between render and subscribe as unavailable', async () => {
    const { useFeatureFlagsStatus } = await import('#lib/analytics/posthog');
    const moduleListeners = mocks.subscriberCount();
    const seen: string[] = [];
    const { result } = renderHook(() => {
      const status = useFeatureFlagsStatus();
      seen.push(status);
      // Layout effects run after render and before passive effects subscribe.
      useLayoutEffect(() => {
        mocks.fireFlagsError();
      }, []);
      return status;
    });

    expect(seen[0]).toBe('pending');
    expect(seen).not.toContain('loaded');
    expect(result.current).toBe('unavailable');
    expect(mocks.subscriberCount()).toBe(moduleListeners + 1);

    act(() => {
      mocks.setFlags({ 'dashboard-v4-experiment': 'd_test' });
      mocks.fireFlags();
    });

    expect(result.current).toBe('loaded');
  });

  // A control user can get a successful answer with no variants. If it lands while the hook
  // moves to unavailable, the replay is the only place it shows up, so it must count.
  it('useFeatureFlagsStatus takes an empty successful answer on re-subscribe as loaded', async () => {
    const { useFeatureFlagsStatus } = await import('#lib/analytics/posthog');
    vi.useFakeTimers();
    try {
      const { result } = renderHook(() => useFeatureFlagsStatus());

      act(() => {
        mocks.setFlags({});
        vi.advanceTimersByTime(5000);
      });

      expect(result.current).toBe('loaded');
    } finally {
      vi.useRealTimers();
    }
  });

  it('useFeatureFlagsStatus recovers to loaded when a load succeeds after a failed one', async () => {
    const { useFeatureFlagsStatus } = await import('#lib/analytics/posthog');

    mocks.fireFlagsError();
    const first = renderHook(() => useFeatureFlagsStatus());
    expect(first.result.current).toBe('unavailable');
    first.unmount();

    act(() => {
      mocks.setFlags({ 'dashboard-v4-experiment': 'control' });
      mocks.fireFlags();
    });

    const second = renderHook(() => useFeatureFlagsStatus());
    expect(second.result.current).toBe('loaded');
  });

  it('useFeatureFlagsStatus is loaded straight away with no PostHog key', async () => {
    vi.stubEnv('VITE_PUBLIC_POSTHOG_KEY', '');
    vi.resetModules();
    const { useFeatureFlagsStatus } = await import('#lib/analytics/posthog');
    const { result } = renderHook(() => useFeatureFlagsStatus());

    expect(result.current).toBe('loaded');
  });
});
