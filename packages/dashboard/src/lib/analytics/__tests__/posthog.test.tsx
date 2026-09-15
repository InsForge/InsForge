import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';

const mocks = vi.hoisted(() => {
  let flagCallback: (() => void) | null = null;
  let currentFlags: Record<string, string | boolean> = {};
  let hasLoadedFlags = false;

  return {
    reset() {
      flagCallback = null;
      currentFlags = {};
      hasLoadedFlags = false;
    },
    setFlags(flags: Record<string, string | boolean>) {
      currentFlags = flags;
      hasLoadedFlags = true;
    },
    fireFlags() {
      flagCallback?.();
    },
    hasSubscriber() {
      return flagCallback !== null;
    },
    posthog: {
      init: vi.fn(),
      getFeatureFlag: vi.fn((key: string) => currentFlags[key]),
      onFeatureFlags: vi.fn((cb: () => void) => {
        flagCallback = cb;
        return () => {
          if (flagCallback === cb) {
            flagCallback = null;
          }
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

  it('useFeatureFlag unsubscribes on unmount', async () => {
    const { useFeatureFlag } = await import('#lib/analytics/posthog');
    const { unmount } = renderHook(() => useFeatureFlag('dashboard-v4-experiment'));

    expect(mocks.hasSubscriber()).toBe(true);
    unmount();
    expect(mocks.hasSubscriber()).toBe(false);
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

  // A quota-limited flags response never reaches onFeatureFlags.
  it('useFeatureFlagsReady stops waiting when flags never load', async () => {
    const { useFeatureFlagsReady } = await import('#lib/analytics/posthog');
    vi.useFakeTimers();
    try {
      const { result } = renderHook(() => useFeatureFlagsReady());
      expect(result.current).toBe(false);

      act(() => {
        vi.advanceTimersByTime(5000);
      });

      expect(result.current).toBe(true);
      expect(mocks.hasSubscriber()).toBe(false);
    } finally {
      vi.useRealTimers();
    }
  });
});
