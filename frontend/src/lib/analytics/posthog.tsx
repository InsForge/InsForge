import posthog from 'posthog-js';
import { PostHogProvider } from 'posthog-js/react';
import { useEffect, useRef } from 'react';
import { isIframe } from '@/lib/utils/utils';

const POSTHOG_KEY = "phc_u7dbRTsO6iP39Fvy8R1M1TicnKNepNLExfw6ZuEq6AG";

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
    console.error('Error initializing PostHog', error);
  }
}

export const PostHogAnalyticsProvider = ({ children }: { children: React.ReactNode }) => {
  const hasRequestedUserInfo = useRef(false);

  // Request user info from parent window for identification (iframe only)
  useEffect(() => {
    if (!isIframe() || !POSTHOG_KEY || hasRequestedUserInfo.current) {
      return;
    }

    hasRequestedUserInfo.current = true;

    const handleMessage = (event: MessageEvent) => {
      if (event.data?.type === 'USER_INFO') {
        const { userId, email, name } = event.data;
        if (userId) {
          posthog.identify(userId, { email, name });
          getFeatureFlag('onboarding-method-experiment');
        }
      }
    };

    window.addEventListener('message', handleMessage);
    window.parent.postMessage({ type: 'REQUEST_USER_INFO' }, '*');

    return () => window.removeEventListener('message', handleMessage);
  }, []);

  if (POSTHOG_KEY) {
    return <PostHogProvider client={posthog}>{children}</PostHogProvider>;
  }
  return <>{children}</>;
};

// ============================================================================
// Track function
// ============================================================================

export const trackPostHog = (eventName: string, properties?: Record<string, unknown>) => {
  if (!POSTHOG_KEY) {
    return;
  }
  posthog.capture(eventName, properties);
};

// ============================================================================
// Feature flag helper
// ============================================================================

export const getFeatureFlag = (featureFlag: string): string | boolean | undefined => {
  if (!POSTHOG_KEY) {
    return undefined;
  }
  return posthog.getFeatureFlag(featureFlag);
};
