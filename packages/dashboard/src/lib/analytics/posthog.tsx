import posthog from 'posthog-js';
import { PostHogProvider } from 'posthog-js/react';
import { maskReplayAttribute } from '#lib/analytics/replay-privacy';

const POSTHOG_KEY = import.meta.env.VITE_PUBLIC_POSTHOG_KEY || '';

if (POSTHOG_KEY) {
  try {
    posthog.init(POSTHOG_KEY, {
      api_host: 'https://us.i.posthog.com',
      capture_exceptions: true,
      debug: import.meta.env.DEV,
      // Autocapture is a separate egress path from session replay: keep clicked
      // elements' text and attributes (which can hold customer data) out of events.
      mask_all_text: true,
      mask_all_element_attributes: true,
      session_recording: {
        // Mask all rendered text and every input so customer data shown in the
        // dashboard (table rows, query results, users, logs, file contents) is
        // never captured. posthog-js masks in the browser, before anything is
        // sent. maskTextSelector: '*' is the supported way to mask all text.
        maskTextSelector: '*',
        maskAllInputs: true,
        // Text masking doesn't reach attributes, and cells repeat their value in
        // title/alt. Fail closed: only layout and UI-state attributes keep values.
        maskAttributeFn: maskReplayAttribute,
        // Pinned: when true it overrides maskAttributeFn, and an unset client value
        // would let a PostHog project setting switch the allowlist off.
        maskAllElementAttributes: false,
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
