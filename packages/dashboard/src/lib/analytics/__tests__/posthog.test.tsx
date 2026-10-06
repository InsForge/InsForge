import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import posthog from 'posthog-js';
import { useFeatureFlag, getFeatureFlag } from '#lib/analytics/posthog';

vi.mock('posthog-js', () => {
  let flagCallback: (() => void) | null = null;
  let currentFlags: Record<string, string | boolean> = {};

  return {
    default: {
      init: vi.fn(),
      getFeatureFlag: vi.fn((key: string) => currentFlags[key]),
      onFeatureFlags: vi.fn((cb: () => void) => {
        flagCallback = cb;
        return () => {
          flagCallback = null;
        };
      }),
      __triggerFeatureFlagsLoaded: (newFlags: Record<string, string | boolean>) => {
        currentFlags = { ...currentFlags, ...newFlags };
        if (flagCallback) {
          flagCallback();
        }
      },
      __reset: () => {
        flagCallback = null;
        currentFlags = {};
      },
    },
  };
});

describe('useFeatureFlag', () => {
  beforeEach(() => {
    vi.stubEnv('VITE_PUBLIC_POSTHOG_KEY', 'phc_test_key');
    // @ts-expect-error test mock helper
    posthog.__reset();
    vi.clearAllMocks();
  });

  it('updates state and re-renders when PostHog finishes loading feature flags', () => {
    const FLAG_NAME = 'dashboard-v4-experiment';

    // 1. Initial render before PostHog loads flags -> returns undefined
    const { result } = renderHook(() => useFeatureFlag(FLAG_NAME));
    expect(result.current).toBeUndefined();

    // 2. Simulate PostHog finishing loading feature flags via network call (/decide)
    act(() => {
      // @ts-expect-error test mock helper
      posthog.__triggerFeatureFlagsLoaded({ [FLAG_NAME]: 'd_test' });
    });

    // 3. Hook updates state and re-renders with 'd_test'
    expect(result.current).toBe('d_test');
  });

  it('unsubscribes from PostHog feature flag callback on unmount', () => {
    const FLAG_NAME = 'dashboard-v4-experiment';
    const { unmount } = renderHook(() => useFeatureFlag(FLAG_NAME));

    expect(posthog.onFeatureFlags).toHaveBeenCalled();
    unmount();
  });
});
