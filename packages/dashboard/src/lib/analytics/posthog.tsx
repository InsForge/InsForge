import { useState, useEffect } from 'react';
import posthog from 'posthog-js';
import { PostHogProvider } from 'posthog-js/react';

const getPostHogKey = (): string => import.meta.env.VITE_PUBLIC_POSTHOG_KEY || '';

if (getPostHogKey()) {
  try {
    posthog.init(getPostHogKey(), {
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
  if (getPostHogKey()) {
    return <PostHogProvider client={posthog}>{children}</PostHogProvider>;
  }
  return <>{children}</>;
};

export const identifyUser = (
  userId: string,
  properties?: Record<string, unknown>
): Promise<void> => {
  if (!getPostHogKey()) {
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
  if (!getPostHogKey()) {
    return undefined;
  }
  return posthog.get_distinct_id();
};

export const trackEvent = (eventName: string, properties?: Record<string, unknown>) => {
  if (!getPostHogKey()) {
    return;
  }
  posthog.capture(eventName, properties);
};

export const getFeatureFlag = (featureFlag: string): string | boolean | undefined => {
  if (!getPostHogKey()) {
    return undefined;
  }
  return posthog.getFeatureFlag(featureFlag);
};

export const useFeatureFlag = (featureFlag: string): string | boolean | undefined => {
  const [flagValue, setFlagValue] = useState<string | boolean | undefined>(() =>
    getFeatureFlag(featureFlag)
  );

  useEffect(() => {
    if (!getPostHogKey()) {
      return;
    }

    setFlagValue(getFeatureFlag(featureFlag));

    const unsubscribe = posthog.onFeatureFlags(() => {
      setFlagValue(getFeatureFlag(featureFlag));
    });

    return () => {
      if (typeof unsubscribe === 'function') {
        unsubscribe();
      }
    };
  }, [featureFlag]);

  return flagValue;
};

