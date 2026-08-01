/**
 * Records which product features an installation touched, so anonymous
 * telemetry can report the features actually in use rather than only the ones
 * an admin configured.
 *
 * Only the set of features is kept — no request counts, no paths, no payloads,
 * no identities, no timings. Reads issued by a dashboard session are ignored,
 * since a tab left open would otherwise mark half the product as used.
 *
 * The set is drained onto each telemetry heartbeat.
 */

import type { Request, Response } from 'express';
import type { AuthRequest } from '@/api/middlewares/auth.js';

export type FeatureUsageSnapshot = {
  featuresUsed: string[];
  windowMs: number;
};

/**
 * Allowlist of countable features, mirroring the routers mounted under /api.
 * An allowlist (rather than "first path segment wins") keeps the property
 * space bounded no matter what an unknown client requests.
 */
const API_FEATURES = new Set([
  'advisor',
  'ai',
  'analytics',
  'auth',
  'compute',
  'database',
  'deployments',
  'docs',
  'email',
  'functions',
  'logs',
  'memory',
  'metadata',
  'payments',
  'realtime',
  'schedules',
  'secrets',
  'storage',
  'usage',
  'webhooks',
  'webscraper',
]);

const READ_METHODS = new Set(['GET', 'HEAD']);

const S3_GATEWAY_PREFIX = '/storage/v1/s3';
const FUNCTION_INVOKE_PREFIX = '/functions/';
/**
 * Dashboard sign-in, token refresh and logout. These fire for as long as a
 * dashboard tab is open, so counting them would mark auth as used on every
 * project, including ones where nobody has ever signed up.
 */
const ADMIN_AUTH_PREFIX = '/api/auth/admin';

/**
 * Maps a request path to the feature it exercises, or null when the request
 * is not feature traffic (dashboard assets, health checks, JWKS, admin auth).
 *
 * The S3 protocol gateway and direct edge-function invocations are counted
 * toward storage and functions: both bypass the /api router, and both are the
 * surfaces a finished app actually calls, so ignoring them would make the two
 * features look unused precisely where they are used most.
 */
export function resolveFeature(pathname: string): string | null {
  if (pathname === S3_GATEWAY_PREFIX || pathname.startsWith(`${S3_GATEWAY_PREFIX}/`)) {
    return 'storage';
  }

  if (
    pathname.startsWith(FUNCTION_INVOKE_PREFIX) &&
    pathname.length > FUNCTION_INVOKE_PREFIX.length
  ) {
    return 'functions';
  }

  if (!pathname.startsWith('/api/')) {
    return null;
  }

  if (pathname === ADMIN_AUTH_PREFIX || pathname.startsWith(`${ADMIN_AUTH_PREFIX}/`)) {
    return null;
  }

  const segment = pathname.slice('/api/'.length).split('/')[0];
  return API_FEATURES.has(segment) ? segment : null;
}

/**
 * Whether the request is a dashboard read: someone looking at the project
 * rather than the project being used.
 *
 * A `project_admin` JWT is only ever issued by an admin sign-in, so it marks a
 * dashboard session. Writes from that session still count — creating a table
 * is using the database — and every non-dashboard request counts regardless of
 * which credential it carried.
 */
export function isDashboardRead(req: Request): boolean {
  if (!READ_METHODS.has(req.method.toUpperCase())) {
    return false;
  }

  return (req as AuthRequest).user?.role === 'project_admin';
}

export class FeatureUsageCollector {
  private static instance: FeatureUsageCollector | undefined;

  private used = new Set<string>();

  private windowStartedAt = Date.now();

  public static getInstance(): FeatureUsageCollector {
    if (!FeatureUsageCollector.instance) {
      FeatureUsageCollector.instance = new FeatureUsageCollector();
    }
    return FeatureUsageCollector.instance;
  }

  public record(feature: string): void {
    this.used.add(feature);
  }

  /**
   * Marks the feature a request exercises as used.
   *
   * The feature is resolved up front, before any router rewrites req.url for
   * its mount path, while the dashboard check waits for 'finish', by which
   * point the auth middleware has resolved the caller. Features already marked
   * this window are skipped outright: there is nothing left to learn about
   * them, so the common case attaches no listener at all.
   */
  public track(req: Request, res: Response): void {
    const feature = resolveFeature(req.path);
    if (!feature || this.used.has(feature)) {
      return;
    }

    res.once('finish', () => {
      if (!isDashboardRead(req)) {
        this.used.add(feature);
      }
    });
  }

  /** Returns the features used since the last drain and starts a new window. */
  public drain(): FeatureUsageSnapshot {
    const now = Date.now();
    const snapshot = this.snapshot(now);

    this.used = new Set();
    this.windowStartedAt = now;

    return snapshot;
  }

  public reset(): void {
    this.used = new Set();
    this.windowStartedAt = Date.now();
  }

  private snapshot(now: number): FeatureUsageSnapshot {
    return {
      featuresUsed: Array.from(this.used).sort(),
      windowMs: Math.max(0, now - this.windowStartedAt),
    };
  }
}
