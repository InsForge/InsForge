import { readLiveConfig } from './read.js';
import { diffConfig, type DiffResult } from './diff.js';
import { validateConfig, type InsforgeConfig } from './schema.js';
import { setAuthSettings } from '../auth/settings.js';
import { upsertBucket, deleteBucket } from '../storage/buckets.js';

export interface ApplyInput {
  config: unknown; // raw JSON; will be validated
  dry_run: boolean;
  prune: boolean;
}

export interface ApplyResult {
  plan: DiffResult;
  applied: boolean;
}

export async function applyConfig(input: ApplyInput): Promise<ApplyResult> {
  const file = validateConfig(input.config);
  const live = await readLiveConfig();
  const plan = diffConfig({ live, file, prune: input.prune });

  if (input.dry_run || plan.changes.length === 0) {
    return { plan, applied: false };
  }

  // Apply auth section if any auth changes are present.
  const authChanges = plan.changes.filter((c) => c.section === 'auth');
  if (authChanges.length > 0 && file.auth) {
    await setAuthSettings({
      additionalRedirectUrls:
        file.auth.additional_redirect_urls ?? live.auth?.additional_redirect_urls ?? [],
    });
  }

  // Apply storage.buckets section.
  for (const c of plan.changes) {
    if (c.section !== 'storage.buckets') {
      continue;
    }
    if (c.op === 'add') {
      await upsertBucket({ name: c.key, public: c.value.public ?? false });
    } else if (c.op === 'modify') {
      await upsertBucket({ name: c.key, public: c.to });
    } else if (c.op === 'remove' && !c.kept) {
      await deleteBucket(c.key);
    }
  }

  return { plan, applied: true };
}

// Export the InsforgeConfig type so route handlers can re-use it without
// reaching into schema.ts.
export type { InsforgeConfig };
