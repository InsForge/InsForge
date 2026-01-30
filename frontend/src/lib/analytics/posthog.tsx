import posthog from 'posthog-js';
import { PostHogProvider } from 'posthog-js/react';
import { useEffect } from 'react';
import { isIframe } from '@/lib/utils/utils';

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

// Module-level flag to survive React StrictMode remounts
let hasIdentifiedUser = false;

export const PostHogAnalyticsProvider = ({ children }: { children: React.ReactNode }) => {
  useEffect(() => {
    if (!isIframe() || !POSTHOG_KEY) {
      return;
    }

    const handleMessage = (event: MessageEvent) => {
      console.warn('[PostHog] handleMessage received', {
        origin: event.origin,
        type: event.data?.type,
        data: event.data,
      });

      // Verify message type
      if (event.data?.type !== 'USER_INFO') {
        return;
      }

      const { userId, email, name } = event.data;
      // Prevent duplicate identification
      if (hasIdentifiedUser) {
        return;
      }

      posthog.identify(userId, { email, name });
      hasIdentifiedUser = true;
      getFeatureFlag('onboard-experiment');
    };

    // Always add listener
    window.addEventListener('message', handleMessage);

    // Send request (with retry for StrictMode timing issues)
    const sendRequest = () => {
      if (!hasIdentifiedUser) {
        window.parent.postMessage({ type: 'REQUEST_USER_INFO' }, '*');
      }
    };

    // Send immediately
    sendRequest();

    // Retry after a short delay in case of StrictMode timing issues
    const retryTimeout = setTimeout(() => {
      if (!hasIdentifiedUser) {
        sendRequest();
      }
    }, 500);

    return () => {
      window.removeEventListener('message', handleMessage);
      clearTimeout(retryTimeout);
    };
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
