import type { InsforgeConfig } from './schema.js';
import { getAuthSettings } from '../auth/settings.js';
import { listBuckets } from '../storage/buckets.js';

/**
 * Reads live project state and projects it into the canonical
 * `insforge.toml` JSON shape. This is the source for `GET /api/config`
 * (used by `insforge config export`) and the "live" side of the diff
 * computed during `POST /api/config/apply`.
 */
export async function readLiveConfig(): Promise<InsforgeConfig> {
  const [auth, buckets] = await Promise.all([getAuthSettings(), listBuckets()]);

  const out: InsforgeConfig = {
    auth: {
      additional_redirect_urls: auth.additionalRedirectUrls,
    },
    storage: {
      buckets: Object.fromEntries(buckets.map((b) => [b.name, { public: b.public }])),
    },
  };

  return out;
}
