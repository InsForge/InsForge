import posthog from 'posthog-js';
import { PostHogProvider } from 'posthog-js/react';

const POSTHOG_KEY = import.meta.env.VITE_PUBLIC_POSTHOG_KEY || '';

if (POSTHOG_KEY) {
  try {
    posthog.init(POSTHOG_KEY, {
      api_host: 'https://us.i.posthog.com',
      capture_exceptions: true, // This enables capturing exceptions using Error Tracking
      debug: import.meta.env.DEV,
      session_recording: {
        // WARNING: Only enable this if you understand the security implications
        recordCrossOriginIframes: true,
      },
    });
  } catch (error) {
    console.error('Error initializing PostHog', error);
  }
}

export const PostHogAnalyticsProvider = ({ children }: { children: React.ReactNode }) => {
  if (POSTHOG_KEY) {
    return <PostHogProvider client={posthog}>{children}</PostHogProvider>;
  }
  return <>{children}</>;
};
