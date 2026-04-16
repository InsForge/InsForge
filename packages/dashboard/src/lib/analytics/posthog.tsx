import posthog from 'posthog-js';
import { PostHogProvider } from 'posthog-js/react';

const POSTHOG_KEY = import.meta.env.VITE_PUBLIC_POSTHOG_KEY || '';

if (POSTHOG_KEY) {
  try {
    posthog.init(POSTHOG_KEY, {
      api_host: 'https://us.i.posthog.com',
      capture_exceptions: true,
      debug: import.meta.env.DEV,
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
  posthog.identify(userId, properties);
  // posthog.identify triggers a new /decide request for the identified user.
  // Wait for it to complete before returning, so callers can rely on
  // getFeatureFlag returning the post-identify variant.
  //
  // Do NOT use posthog.onFeatureFlags here: if PostHog already loaded flags
  // for the anonymous device id (which happens on init), onFeatureFlags fires
  // synchronously with that stale cache. Await would resolve immediately and
  // the next getFeatureFlag would return the anonymous variant.
  return new Promise<void>((resolve) => setTimeout(resolve, 2000));
};

export const trackPostHog = (eventName: string, properties?: Record<string, unknown>) => {
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
