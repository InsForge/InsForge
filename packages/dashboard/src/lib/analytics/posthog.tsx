import { useEffect, useReducer, useState } from 'react';
import posthog from 'posthog-js';
import { PostHogProvider } from 'posthog-js/react';

const POSTHOG_KEY = import.meta.env.VITE_PUBLIC_POSTHOG_KEY || '';

if (POSTHOG_KEY) {
  try {
    posthog.init(POSTHOG_KEY, {
      api_host: 'https://us.i.posthog.com',
      capture_exceptions: true,
      debug: import.meta.env.DEV,
      session_recording: {
        recordCrossOriginIframes: true,
      },
    });
  } catch (error) {
    console.error('[PostHog] ❌ Error initializing PostHog', error);
  }
}

export const PostHogAnalyticsProvider = ({ children }: { children: React.ReactNode }) => {
  if (POSTHOG_KEY) {
    return <PostHogProvider client={posthog}>{children}</PostHogProvider>;
  }
  return <>{children}</>;
};

export const identifyUser = (
  userId: string,
  properties?: Record<string, unknown>
): Promise<void> => {
  if (!POSTHOG_KEY) {
    return Promise.resolve();
  }

  // Detect whether feature flags are already loaded in posthog-js. When we
  // register a callback via onFeatureFlags, posthog-js fires it synchronously
  // with cached flags if a prior /decide has already completed (typically the
  // anonymous-id init request). We use this to decide whether to skip the
  // "stale" first callback and wait for the next one (triggered by the
  // identify-initiated /decide).
  //
  // DEPENDENCY: relies on posthog-js's sync-fire-if-loaded behavior for
  // onFeatureFlags. Verified in posthog-js 1.364.x. If upgrading posthog-js
  // major version, re-verify this behavior in the changelog.
  let preloaded = false;
  posthog.onFeatureFlags(() => {
    preloaded = true;
  });
  const target = preloaded ? 2 : 1;

  posthog.identify(userId, properties);

  return new Promise<void>((resolve) => {
    const timeout = setTimeout(() => resolve(), 5000);
    let fires = 0;
    posthog.onFeatureFlags(() => {
      fires++;
      if (fires >= target) {
        clearTimeout(timeout);
        resolve();
      }
    });
  });
};

export const getCurrentDistinctId = (): string | undefined => {
  if (!POSTHOG_KEY) {
    return undefined;
  }
  return posthog.get_distinct_id();
};

export const trackEvent = (eventName: string, properties?: Record<string, unknown>) => {
  if (!POSTHOG_KEY) {
    return;
  }
  posthog.capture(eventName, properties);
};

export const getFeatureFlag = (featureFlag: string): string | boolean | undefined => {
  if (!POSTHOG_KEY) {
    return undefined;
  }
  return posthog.getFeatureFlag(featureFlag);
};

// posthog-js abandons a slow flags request after feature_flag_request_timeout_ms and still
// calls back, so every real answer lands inside that window. Only a quota-limited response
// skips the callback entirely, and that is what waiting a little past the timeout catches.
const FEATURE_FLAGS_WAIT_MARGIN_MS = 2000;

// A flag that is not set and flags that have not loaded yet both read as undefined.
// This tells them apart. Without a PostHog key there is nothing to wait for.
export const useFeatureFlagsReady = (): boolean => {
  const [ready, setReady] = useState(
    () => !POSTHOG_KEY || posthog.featureFlags?.hasLoadedFlags === true
  );

  useEffect(() => {
    if (!POSTHOG_KEY || ready) {
      return;
    }
    const waitMs = posthog.config.feature_flag_request_timeout_ms + FEATURE_FLAGS_WAIT_MARGIN_MS;
    const timeout = setTimeout(() => setReady(true), waitMs);
    // Fires straight away if flags loaded after the initial render.
    const unsubscribe = posthog.onFeatureFlags(() => setReady(true));
    return () => {
      clearTimeout(timeout);
      unsubscribe();
    };
  }, [ready]);

  return ready;
};

// Use in render instead of getFeatureFlag, which only reads the value once.
export const useFeatureFlag = (featureFlag: string): string | boolean | undefined => {
  const [, rerender] = useReducer((count: number) => count + 1, 0);

  useEffect(() => {
    if (!POSTHOG_KEY) {
      return;
    }
    return posthog.onFeatureFlags(() => rerender());
  }, []);

  // Read during render, so a changed key never returns the previous key's value.
  return getFeatureFlag(featureFlag);
};
