// Resolve the cloud-shell parent origin. In dev (`import.meta.env.DEV`), an unset
// VITE_CLOUD_SHELL_ORIGIN falls back to '*' so the iframe works against any
// localhost cloud-shell port. In a production build, an unset env is a config
// error — we hard-fail to `''` so `requestPosthogConnect` becomes a no-op and the
// incoming origin check rejects every message, rather than silently fail-open
// with '*'.
const PARENT_ORIGIN: string =
  import.meta.env.VITE_CLOUD_SHELL_ORIGIN ?? (import.meta.env.DEV ? '*' : '');

export interface PosthogConnectionStatusEvent {
  type: 'POSTHOG_CONNECTION_STATUS';
  status: 'connected' | 'error' | 'cancelled';
  reason?: string;
  timestamp: number;
}

/**
 * Sent from the OSS dashboard iframe up to the cloud-shell parent
 * when the user clicks Connect PostHog. Parent listens via
 * BroadcastListener and navigates top.location to the start endpoint.
 */
export function requestPosthogConnect(projectId: string): void {
  if (!PARENT_ORIGIN) {
    return;
  }
  window.parent.postMessage(
    {
      type: 'POSTHOG_CONNECT_REQUEST',
      projectId,
      timestamp: Date.now(),
    },
    PARENT_ORIGIN
  );
}

/**
 * Listen for POSTHOG_CONNECTION_STATUS events posted from the cloud shell
 * after OAuth completes. Returns an unsubscribe function.
 *
 * Verifies the message origin matches the configured parent origin (when set)
 * to prevent cross-origin spoofing.
 */
export function onPosthogConnectionStatus(
  cb: (e: PosthogConnectionStatusEvent) => void
): () => void {
  function listener(ev: MessageEvent) {
    if (PARENT_ORIGIN !== '*' && ev.origin !== PARENT_ORIGIN) {
      return;
    }
    if (ev.source !== window.parent) {
      return;
    }
    if (ev.data?.type === 'POSTHOG_CONNECTION_STATUS') {
      cb(ev.data as PosthogConnectionStatusEvent);
    }
  }
  window.addEventListener('message', listener);
  return () => window.removeEventListener('message', listener);
}
