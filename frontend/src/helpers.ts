const CLOUD_HOSTING_DOMAIN_SUFFIX = '.insforge.app';

const PROBE_TIMEOUT_MS = 3000;

/**
 * What `GET /api/health` reported for `cloud`, or null if it has not answered.
 */
let backendReportedCloud: boolean | null = null;

/**
 * Ask the backend whether it is running in a cloud environment.
 *
 * The backend already knows this for certain (`isCloudEnvironment()`, which
 * gates whether backup routes are even mounted). The browser can only guess
 * from its own hostname, and that guess is wrong for a cloud deployment served
 * on a custom domain. Resolve before the first render so `isCloudHosting()`
 * stays synchronous for callers.
 *
 * Failure is not fatal: leaving `backendReportedCloud` null keeps the previous
 * hostname behaviour, so an unreachable or older backend degrades to exactly
 * what shipped before. The timeout matters for the same reason — the first
 * render waits on this, and a backend that hangs rather than refuses must not
 * hold the shell forever.
 */
export async function probeCloudHosting(): Promise<void> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), PROBE_TIMEOUT_MS);

  try {
    const response = await fetch('/api/health', {
      headers: { Accept: 'application/json' },
      signal: controller.signal,
    });
    if (!response.ok) {
      return;
    }

    const body: unknown = await response.json();
    if (
      typeof body === 'object' &&
      body !== null &&
      typeof (body as { cloud?: unknown }).cloud === 'boolean'
    ) {
      backendReportedCloud = (body as { cloud: boolean }).cloud;
    }
  } catch {
    // Keep the hostname fallback below.
  } finally {
    clearTimeout(timeout);
  }
}

export function isCloudHosting(): boolean {
  if (backendReportedCloud !== null) {
    return backendReportedCloud;
  }

  if (typeof window === 'undefined') {
    return false;
  }

  return window.location.origin.endsWith(CLOUD_HOSTING_DOMAIN_SUFFIX);
}

export function isInIframe(): boolean {
  if (typeof window === 'undefined') {
    return false;
  }

  return window.parent !== window;
}
