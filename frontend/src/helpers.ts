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
/**
 * A signal that aborts after `PROBE_TIMEOUT_MS`.
 *
 * `AbortSignal.timeout` is the concise form but is unsupported on older browsers, where it throws.
 * That throw is caught below, so nothing breaks — but the probe would be skipped and the shell
 * would fall back to the hostname guess, which is the exact bug this exists to fix, silently and
 * only for those users. The manual controller works everywhere, so it is the fallback.
 */
function timeoutSignal(): AbortSignal | undefined {
  if ('function' === typeof AbortSignal.timeout) {
    return AbortSignal.timeout(PROBE_TIMEOUT_MS);
  }
  if ('undefined' === typeof AbortController) {
    return undefined;
  }
  const controller = new AbortController();
  setTimeout(() => controller.abort(), PROBE_TIMEOUT_MS);
  return controller.signal;
}

export async function probeCloudHosting(): Promise<void> {
  try {
    const response = await fetch('/api/health', {
      headers: { Accept: 'application/json' },
      signal: timeoutSignal(),
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
