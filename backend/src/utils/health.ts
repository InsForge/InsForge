/**
 * Payload for `GET /api/health`.
 */

import { isCloudEnvironment } from './environment.js';

export interface HealthPayload {
  status: 'ok';
  version: string;
  service: string;
  /**
   * Whether this backend is running in a cloud environment.
   *
   * The dashboard shell cannot determine this from the browser: a cloud
   * deployment served on a custom domain is indistinguishable from a
   * self-hosted one by hostname alone. This is the same value that decides
   * whether backup routes are mounted, so the two cannot drift.
   */
  cloud: boolean;
  timestamp: string;
}

export function buildHealthPayload(version: string, now: Date = new Date()): HealthPayload {
  return {
    status: 'ok',
    version,
    service: 'Insforge OSS Backend',
    cloud: isCloudEnvironment(),
    timestamp: now.toISOString(),
  };
}
