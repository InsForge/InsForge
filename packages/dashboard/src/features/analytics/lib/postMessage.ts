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
  window.parent.postMessage(
    {
      type: 'POSTHOG_CONNECT_REQUEST',
      projectId,
      timestamp: Date.now(),
    },
    '*'
  );
}

/**
 * Listen for POSTHOG_CONNECTION_STATUS events posted from the cloud shell
 * after OAuth completes. Returns an unsubscribe function.
 */
export function onPosthogConnectionStatus(
  cb: (e: PosthogConnectionStatusEvent) => void
): () => void {
  function listener(ev: MessageEvent) {
    if (ev.data?.type === 'POSTHOG_CONNECTION_STATUS') {
      cb(ev.data as PosthogConnectionStatusEvent);
    }
  }
  window.addEventListener('message', listener);
  return () => window.removeEventListener('message', listener);
}
