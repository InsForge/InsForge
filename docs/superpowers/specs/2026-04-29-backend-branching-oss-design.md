# Backend Branching (OSS) — Design

**Date:** 2026-04-29
**Status:** Draft
**Source PRD:** [insforge-cloud-backend Backend-Branching.md](../../../../insforge-cloud-backend/Backend-Branching.md)
**Cloud-backend spec:** [2026-04-29-backend-branching-cloud-design.md](../../../../insforge-cloud-backend/docs/superpowers/specs/2026-04-29-backend-branching-cloud-design.md)

This spec covers the **OSS slice** of backend branching v1: read-only fallback from a branch project's storage to its parent project's S3 directory.

## Problem

When a branch project is created from a parent, copying every storage object would be slow and wasteful (parent may have GB of files). The cloud-backend spec dictates: branch's S3 directory starts empty; reads of parent objects must transparently succeed via fallback. Branch writes go to branch's directory only; parent files are never modified from a branch.

## Goals (v1)

1. The OSS storage server, when started in "branch mode" (with an injected `PARENT_APP_KEY` env var), reads object data from parent's S3 path when the branch's path returns nothing.
2. Fallback is **read-only**. Writes (PUT/DELETE/multipart-upload) always target the branch's own appkey path.
3. Existing RLS / bucket-visibility checks continue to apply unchanged.
4. No HTTP API additions. Behavior change is server-internal.
5. Local-storage provider does **not** support fallback (cloud-only). Local installs are not branched.

## Non-Goals (v1)

- Cross-project fallback for non-branch projects.
- Write-through: copying a parent object into branch when first written to (CoW). Branches always start with the empty file set in their own namespace; modifications create new objects.
- Deletion markers: branch cannot "hide" a parent file. Deleting from a branch only deletes the branch's own copy (which doesn't exist for inherited files), so the parent file remains visible. Documented as v1 limitation.
- Schema-only mode files: when the branch was created with `mode='schema-only'`, the cloud-backend truncates `storage.objects`, so RLS/metadata returns 404 for parent files. This matches "fresh start" semantics — fallback is only effective for `mode='full'` branches.

## Current State Summary

- OSS storage server: TypeScript / Express monorepo at `backend/`. See [backend/src/server.ts:1-80](../../../backend/src/server.ts).
- S3 path layout: `{appKey}/{bucketName}/{key}` in a single shared bucket (`AWS_S3_BUCKET`). Code in [backend/src/providers/storage/s3.provider.ts:91-93](../../../backend/src/providers/storage/s3.provider.ts).
- `appKey` loaded from `APP_KEY` env var at server startup. Singleton pattern in [backend/src/services/storage/storage.service.ts:29-45](../../../backend/src/services/storage/storage.service.ts).
- HTTP read endpoint: `GET /api/storage/buckets/:bucketName/objects/*` ([backend/src/api/routes/storage/index.routes.ts:398-459](../../../backend/src/api/routes/storage/index.routes.ts)).
- `StorageService.getObject` returns `null` if metadata absent or S3 returns nothing — these are the natural interception points for fallback ([backend/src/services/storage/storage.service.ts:201-238](../../../backend/src/services/storage/storage.service.ts)).
- Presigned URL flow: `getDownloadStrategy` → `getPresignedUrl` (S3 sigV4 GET against `{appKey}/{bucket}/{key}`).

## Design

### Configuration

New env var:
- `PARENT_APP_KEY` (optional). When set, the server runs in "branch mode" and falls back to this appkey for object reads.

The cloud-backend injects this at branch container startup (alongside the existing `APP_KEY`).

### S3 Provider Changes

Extend `S3StorageProvider` to optionally hold a `parentAppKey`:

```typescript
constructor(
  private s3Bucket: string,
  private appKey: string,
  private region: string = 'us-east-2',
  private parentAppKey?: string,
) { ... }

private getS3Key(bucket: string, key: string): string {
  return `${this.appKey}/${bucket}/${key}`;
}
private getParentS3Key(bucket: string, key: string): string | null {
  return this.parentAppKey ? `${this.parentAppKey}/${bucket}/${key}` : null;
}
```

Read methods (`getObject`, `headObject`, `getObjectStream`, `getPresignedUrl`) get a single new helper:

```typescript
private async withFallback<T>(primary: () => Promise<T | null>, parent: () => Promise<T | null>): Promise<T | null> {
  const a = await primary();
  if (a !== null) return a;
  if (!this.parentAppKey) return null;
  return parent();
}
```

Each read becomes:
- Attempt with `getS3Key(bucket, key)`. On null/404 → if `parentAppKey` set, attempt with `getParentS3Key(bucket, key)`.

Write methods (`putObject`, `deleteObject`, `createMultipartUpload`, etc.) do **not** call the fallback — they always target `getS3Key`.

### Presigned URLs

`getPresignedUrl(bucket, key)` is the only read path that doesn't actually fetch the object — it just constructs a signed URL. For fallback to work for presigned URLs, we must do a `headObject` first against the branch path; if 404, sign against the parent path. This adds a HEAD round-trip but is required for correctness.

### Service Layer

`StorageService.getObject` and `objectIsVisible` rely on a metadata row in `storage.objects`. For `mode='full'` branches, that row exists (copied via pg_dump). The provider does the actual S3 fallback; service layer needs no change.

For `mode='schema-only'` branches, `storage.objects` is truncated by the cloud-backend after restore. Result: branch users get 404 from RLS lookup, never reaching the provider. This is the expected behavior — the storage feature simply doesn't apply.

### Failure Modes

- `parentAppKey` set but parent's directory was deleted (branch outlived parent — shouldn't happen given lifecycle cascade): primary 404 + parent 404 → final 404. Same as today.
- Parent exists but specific key missing on parent too: same 404. No new error path.
- IAM error reading parent path (cross-prefix permission denied): logged as warning, behaves as 404. The IAM role for the EC2 already has access to the entire `insforge-storage` bucket per the existing single-bucket model; no permissions change required.

### Compatibility

- Local storage provider: ignored. `LocalStorageProvider` never receives `parentAppKey`. The constructor signature can be extended for symmetry but the fallback path no-ops.
- Existing non-branch projects: `PARENT_APP_KEY` is unset → fallback path never executes → zero behavior change.

## API

No new HTTP endpoints. Existing endpoints' behavior changes only for branches with `PARENT_APP_KEY` set, and only for read paths.

## Acceptance

A branch container started with `APP_KEY=branchkey` and `PARENT_APP_KEY=parentkey`:
1. `GET /api/storage/buckets/foo/objects/path/to/file.jpg` returns the file from `parentkey/foo/path/to/file.jpg` if `branchkey/foo/path/to/file.jpg` doesn't exist (assuming branch DB has the metadata row).
2. `PUT /api/storage/buckets/foo/objects/path/to/file.jpg` writes to `branchkey/foo/path/to/file.jpg` only.
3. After (2), step (1) returns the new branch-local file (branch path takes priority).
4. `DELETE /api/storage/buckets/foo/objects/path/to/file.jpg` (after 2) removes the branch's copy. Subsequent GET falls back to parent file again.
5. RLS still gates: a user without read access to the bucket gets 404, regardless of fallback.

## Open Questions / TBD

1. **Deletion markers (post-v1).** A branch may want to "hide" a parent file. Requires a sentinel object or a row in branch's metadata. Not in v1.
2. **CoW write-through.** When a branch writes to `path/to/file.jpg` after reading the parent's version, should we copy on first write? Today writing creates a fresh file at the branch path; reads naturally see the new file. No copy needed unless we want diff/merge of file contents (not in product scope).
3. **Schema-only branch + storage**. Confirm with cloud-backend team: should schema-only mode skip truncating `storage.objects`, so storage fallback works in that mode too? Current spec assumes truncate (matching "fresh start"). Worth a one-line check.
