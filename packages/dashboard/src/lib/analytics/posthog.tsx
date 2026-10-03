import { useEffect, useReducer, useState } from 'react';
import posthog from 'posthog-js';
import { PostHogProvider } from 'posthog-js/react';

const POSTHOG_KEY = import.meta.env.VITE_PUBLIC_POSTHOG_KEY || '';

// posthog-js marks flags as loaded before it reports a failed request, so hasLoadedFlags cannot
// tell a failure from an answer. This remembers how the last request ended, for a status hook
// that mounts after it.
let lastFlagsRequestFailed = false;

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
    // Registered before the first flags request, so it hears how every request ends.
    posthog.onFeatureFlags((_flags, _variants, context) => {
      lastFlagsRequestFailed = context?.errorsLoading === true;
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

// posthog-js gives up on a slow flags request after feature_flag_request_timeout_ms and calls
// back with errorsLoading, so a failed request reports itself. A quota-limited response is the
// one case that skips the callback entirely, and this margin is what catches it. Reaching the
// margin is the end of waiting for an answer, not an answer.
const FEATURE_FLAGS_WAIT_MARGIN_MS = 2000;

/**
 * `pending` while an answer may still arrive, `loaded` once the flags are known, and
 * `unavailable` when PostHog reported the request failed or nothing came back at all.
 *
 * `unavailable` is not a variant. Every flag reads as undefined in that state, which is also
 * what a control user reads, so a decision that cannot be taken back (a redirect, a one-shot
 * dialog) must not treat the two as the same thing.
 */
export type FeatureFlagsStatus = 'pending' | 'loaded' | 'unavailable';

export const useFeatureFlagsStatus = (): FeatureFlagsStatus => {
  // Without a PostHog key there is nothing to wait for and no flag will ever be set.
  const [status, setStatus] = useState<FeatureFlagsStatus>(() => {
    if (!POSTHOG_KEY) {
      return 'loaded';
    }
    if (posthog.featureFlags?.hasLoadedFlags !== true) {
      return 'pending';
    }
    return lastFlagsRequestFailed ? 'unavailable' : 'loaded';
  });

  useEffect(() => {
    if (status === 'loaded') {
      return;
    }
    // Fires straight away if flags loaded after the initial render. After a failed request
    // PostHog also counts flags as loaded, so that immediate callback replays the failure with
    // no errorsLoading, whether the hook is re-subscribing from `unavailable` or the request
    // failed between render and this effect. Read it as unavailable only when the last request
    // did fail: a successful answer, even one with no variants, is still an answer.
    let subscribing = true;
    const unsubscribe = posthog.onFeatureFlags((_flags, _variants, context) => {
      if (subscribing && lastFlagsRequestFailed) {
        setStatus('unavailable');
        return;
      }
      setStatus(context?.errorsLoading ? 'unavailable' : 'loaded');
    });
    subscribing = false;
    if (status === 'unavailable') {
      // The wait is already over. Keep listening, because a late answer still upgrades this.
      return unsubscribe;
    }
    const waitMs = posthog.config.feature_flag_request_timeout_ms + FEATURE_FLAGS_WAIT_MARGIN_MS;
    const timeout = setTimeout(() => setStatus('unavailable'), waitMs);
    return () => {
      clearTimeout(timeout);
      unsubscribe();
    };
  }, [status]);

  return status;
};

// True once there is no point waiting longer, whether or not the variant is known. For a
// decision that has to be made either way. Where an unknown variant must not be read as the
// default one, use useFeatureFlagsStatus and handle `unavailable` on its own.
export const useFeatureFlagsReady = (): boolean => useFeatureFlagsStatus() !== 'pending';

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
