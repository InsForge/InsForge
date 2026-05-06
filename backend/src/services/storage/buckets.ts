// Thin wrapper around StorageService for the config-apply orchestrator.
// Exposes listBuckets / upsertBucket / deleteBucket in a shape the config
// service can consume without depending on the broader StorageService API.

import { StorageService } from './storage.service.js';

export interface BucketRecord {
  name: string;
  public: boolean;
}

export interface UpsertBucketInput {
  name: string;
  public: boolean;
}

export async function listBuckets(): Promise<BucketRecord[]> {
  const buckets = await StorageService.getInstance().listBuckets();
  return buckets.map((b) => ({ name: b.name, public: b.public }));
}

/**
 * Idempotent: creates the bucket if absent, otherwise updates its visibility
 * to match. Required for `insforge config apply` to be safe to re-run.
 */
export async function upsertBucket(input: UpsertBucketInput): Promise<void> {
  const svc = StorageService.getInstance();
  const exists = await svc.bucketExists(input.name);
  if (exists) {
    await svc.updateBucketVisibility(input.name, input.public);
  } else {
    await svc.createBucket(input.name, input.public);
  }
}

export async function deleteBucket(name: string): Promise<void> {
  await StorageService.getInstance().deleteBucket(name);
}
