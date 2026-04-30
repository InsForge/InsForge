# Backend Branching (OSS) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans. Steps use checkbox (`- [ ]`) syntax.

**Goal:** Add read-only fallback from a branch project's storage to its parent project's S3 directory, gated by a new `PARENT_APP_KEY` env var. Read-only, transparent, no HTTP API changes.

**Architecture:** Extend `S3StorageProvider` with an optional `parentAppKey`. Read methods (`getObject`, `headObject`, `getObjectStream`, `getPresignedUrl`) attempt the branch's S3 path first; on 404, retry the parent's path. Writes always target the branch path. Service layer and HTTP routes unchanged.

**Tech Stack:** TypeScript, Node.js, Express, AWS SDK v3 (`@aws-sdk/client-s3`), Vitest.

**Spec:** [docs/superpowers/specs/2026-04-29-backend-branching-oss-design.md](../specs/2026-04-29-backend-branching-oss-design.md)

---

## File Structure

**Modify:**
- `backend/src/providers/storage/s3.provider.ts` — accept `parentAppKey`, add fallback in read methods
- `backend/src/services/storage/storage.service.ts` — pass `PARENT_APP_KEY` env var into provider constructor
- `backend/src/providers/storage/storage.provider.ts` (interface, if any) — no new methods, just a fallback-aware contract

**Create:**
- `backend/tests/unit/storage-s3-fallback.test.ts` — fallback behavior unit tests

---

## Task 1: Extend S3StorageProvider Constructor

**Files:**
- Modify: `backend/src/providers/storage/s3.provider.ts:49-56`

- [ ] **Step 1: Accept `parentAppKey` in constructor**

```typescript
export class S3StorageProvider implements StorageProvider {
  private s3Client: S3Client | null = null;

  constructor(
    private s3Bucket: string,
    private appKey: string,
    private region: string = 'us-east-2',
    private parentAppKey?: string,
  ) {
    // ... existing init ...
  }

  private getS3Key(bucket: string, key: string): string {
    return `${this.appKey}/${bucket}/${key}`;
  }

  private getParentS3Key(bucket: string, key: string): string | null {
    return this.parentAppKey ? `${this.parentAppKey}/${bucket}/${key}` : null;
  }
}
```

- [ ] **Step 2: Run typecheck**

Run: `cd backend && npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add backend/src/providers/storage/s3.provider.ts
git commit -m "feat(branching): S3StorageProvider accepts optional parentAppKey"
```

---

## Task 2: Fallback in Read Methods (TDD)

**Files:**
- Create: `backend/tests/unit/storage-s3-fallback.test.ts`
- Modify: `backend/src/providers/storage/s3.provider.ts` (`getObject`, `headObject`, `getObjectStream`)

- [ ] **Step 1: Write failing tests**

```typescript
// backend/tests/unit/storage-s3-fallback.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { S3StorageProvider } from '@/providers/storage/s3.provider.js';
import { GetObjectCommand, S3Client } from '@aws-sdk/client-s3';

describe('S3StorageProvider fallback to parent', () => {
  let sendMock: ReturnType<typeof vi.fn>;
  beforeEach(() => {
    sendMock = vi.fn();
    vi.spyOn(S3Client.prototype, 'send').mockImplementation(sendMock as any);
  });

  it('returns branch object when present (no fallback call)', async () => {
    sendMock.mockResolvedValueOnce({ Body: streamOf('hello') });
    const p = new S3StorageProvider('bucket', 'branchkey', 'us-east-2', 'parentkey');
    (p as any).s3Client = new S3Client({});  // bypass async init for unit
    const out = await p.getObject('foo', 'a.txt');
    expect(out?.toString()).toBe('hello');
    expect(sendMock).toHaveBeenCalledTimes(1);
    const cmd: any = sendMock.mock.calls[0][0];
    expect(cmd.input.Key).toBe('branchkey/foo/a.txt');
  });

  it('falls back to parent when branch returns NoSuchKey', async () => {
    const noSuchKey = Object.assign(new Error('NoSuchKey'), { name: 'NoSuchKey' });
    sendMock.mockRejectedValueOnce(noSuchKey).mockResolvedValueOnce({ Body: streamOf('parent-data') });
    const p = new S3StorageProvider('bucket', 'branchkey', 'us-east-2', 'parentkey');
    (p as any).s3Client = new S3Client({});
    const out = await p.getObject('foo', 'a.txt');
    expect(out?.toString()).toBe('parent-data');
    const k1 = (sendMock.mock.calls[0][0] as any).input.Key;
    const k2 = (sendMock.mock.calls[1][0] as any).input.Key;
    expect(k1).toBe('branchkey/foo/a.txt');
    expect(k2).toBe('parentkey/foo/a.txt');
  });

  it('returns null when both branch and parent are missing', async () => {
    const noSuchKey = Object.assign(new Error('NoSuchKey'), { name: 'NoSuchKey' });
    sendMock.mockRejectedValueOnce(noSuchKey).mockRejectedValueOnce(noSuchKey);
    const p = new S3StorageProvider('bucket', 'branchkey', 'us-east-2', 'parentkey');
    (p as any).s3Client = new S3Client({});
    const out = await p.getObject('foo', 'a.txt');
    expect(out).toBeNull();
  });

  it('does NOT fall back when parentAppKey is unset', async () => {
    const noSuchKey = Object.assign(new Error('NoSuchKey'), { name: 'NoSuchKey' });
    sendMock.mockRejectedValueOnce(noSuchKey);
    const p = new S3StorageProvider('bucket', 'branchkey', 'us-east-2');  // no parentAppKey
    (p as any).s3Client = new S3Client({});
    const out = await p.getObject('foo', 'a.txt');
    expect(out).toBeNull();
    expect(sendMock).toHaveBeenCalledTimes(1);
  });
});

function streamOf(s: string) {
  const { Readable } = require('node:stream');
  return Readable.from([Buffer.from(s)]);
}
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd backend && npx vitest run tests/unit/storage-s3-fallback.test.ts`
Expected: FAIL — fallback not yet implemented.

- [ ] **Step 3: Implement fallback in `getObject`**

```typescript
async getObject(bucket: string, key: string): Promise<Buffer | null> {
  if (!this.s3Client) throw new Error('S3 client not initialized');
  const primary = await this.tryGet(this.getS3Key(bucket, key));
  if (primary !== null) return primary;
  const parentKey = this.getParentS3Key(bucket, key);
  if (!parentKey) return null;
  return this.tryGet(parentKey);
}

private async tryGet(s3Key: string): Promise<Buffer | null> {
  try {
    const cmd = new GetObjectCommand({ Bucket: this.s3Bucket, Key: s3Key });
    const res = await this.s3Client!.send(cmd);
    if (!res.Body) return null;
    const chunks: Buffer[] = [];
    // @ts-ignore SDK v3 stream
    for await (const c of res.Body) chunks.push(Buffer.isBuffer(c) ? c : Buffer.from(c));
    return Buffer.concat(chunks);
  } catch (err: any) {
    if (err?.name === 'NoSuchKey' || err?.$metadata?.httpStatusCode === 404) return null;
    throw err;
  }
}
```

- [ ] **Step 4: Implement fallback in `headObject` and `getObjectStream`**

Apply the same primary-then-parent pattern:

```typescript
async headObject(bucket: string, key: string): Promise<{ size: number; mimeType: string } | null> {
  const tryHead = async (s3Key: string) => {
    try {
      const res = await this.s3Client!.send(new HeadObjectCommand({ Bucket: this.s3Bucket, Key: s3Key }));
      return { size: res.ContentLength ?? 0, mimeType: res.ContentType ?? 'application/octet-stream' };
    } catch (err: any) {
      if (err?.name === 'NotFound' || err?.$metadata?.httpStatusCode === 404) return null;
      throw err;
    }
  };
  const primary = await tryHead(this.getS3Key(bucket, key));
  if (primary) return primary;
  const parentKey = this.getParentS3Key(bucket, key);
  return parentKey ? tryHead(parentKey) : null;
}
```

Mirror the pattern in `getObjectStream` if present.

- [ ] **Step 5: Run tests**

Run: `cd backend && npx vitest run tests/unit/storage-s3-fallback.test.ts`
Expected: all four cases pass.

- [ ] **Step 6: Commit**

```bash
git add backend/src/providers/storage/s3.provider.ts backend/tests/unit/storage-s3-fallback.test.ts
git commit -m "feat(branching): read-only S3 fallback to parent appkey on 404"
```

---

## Task 3: Fallback in Presigned URL Generation

**Files:**
- Modify: `backend/src/providers/storage/s3.provider.ts` (`getPresignedUrl` method)

- [ ] **Step 1: Write failing test**

Add to `backend/tests/unit/storage-s3-fallback.test.ts`:

```typescript
it('presigned URL: signs branch key when present', async () => {
  // Mock HeadObject to succeed for branch path
  sendMock.mockResolvedValueOnce({ ContentLength: 5 });
  const p = new S3StorageProvider('bucket', 'branchkey', 'us-east-2', 'parentkey');
  (p as any).s3Client = new S3Client({});
  const url = await p.getPresignedUrl('foo', 'a.txt');
  expect(url).toContain('branchkey/foo/a.txt');
});

it('presigned URL: signs parent key when branch HEAD returns 404', async () => {
  const notFound = Object.assign(new Error('NotFound'), { name: 'NotFound' });
  sendMock.mockRejectedValueOnce(notFound);
  sendMock.mockResolvedValueOnce({ ContentLength: 7 });
  const p = new S3StorageProvider('bucket', 'branchkey', 'us-east-2', 'parentkey');
  (p as any).s3Client = new S3Client({});
  const url = await p.getPresignedUrl('foo', 'a.txt');
  expect(url).toContain('parentkey/foo/a.txt');
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd backend && npx vitest run tests/unit/storage-s3-fallback.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implement fallback for `getPresignedUrl`**

```typescript
async getPresignedUrl(bucket: string, key: string, expiresIn = 3600): Promise<string> {
  // Decide which path to sign by checking existence first.
  const branchKey = this.getS3Key(bucket, key);
  const parentKey = this.getParentS3Key(bucket, key);
  let signKey = branchKey;
  if (parentKey) {
    const exists = await this.objectExists(branchKey);
    if (!exists) signKey = parentKey;
  }
  const cmd = new GetObjectCommand({ Bucket: this.s3Bucket, Key: signKey });
  return getSignedUrl(this.s3Client!, cmd, { expiresIn });
}

private async objectExists(s3Key: string): Promise<boolean> {
  try {
    await this.s3Client!.send(new HeadObjectCommand({ Bucket: this.s3Bucket, Key: s3Key }));
    return true;
  } catch (err: any) {
    if (err?.name === 'NotFound' || err?.$metadata?.httpStatusCode === 404) return false;
    throw err;
  }
}
```

- [ ] **Step 4: Run tests**

Run: `cd backend && npx vitest run tests/unit/storage-s3-fallback.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add backend/src/providers/storage/s3.provider.ts backend/tests/unit/storage-s3-fallback.test.ts
git commit -m "feat(branching): presigned URL fallback to parent path"
```

---

## Task 4: Wire `PARENT_APP_KEY` Env Var Through StorageService

**Files:**
- Modify: `backend/src/services/storage/storage.service.ts:29-45`

- [ ] **Step 1: Pass `PARENT_APP_KEY` to S3StorageProvider**

```typescript
private constructor() {
  const s3Bucket = process.env.AWS_S3_BUCKET;
  const appKey = process.env.APP_KEY || 'local';
  const parentAppKey = process.env.PARENT_APP_KEY;  // <-- new

  if (s3Bucket) {
    this.provider = new S3StorageProvider(
      s3Bucket,
      appKey,
      process.env.AWS_REGION || 'us-east-2',
      parentAppKey,
    );
    if (parentAppKey) {
      logger.info('Storage initialized in branch mode', { appKey, parentAppKey });
    }
  } else {
    // local storage — fallback unsupported in v1, ignore
    const baseDir = process.env.STORAGE_DIR || path.resolve(process.cwd(), 'insforge-storage');
    this.provider = new LocalStorageProvider(baseDir);
  }
}
```

- [ ] **Step 2: Verify boot log**

Run:
```bash
cd backend
APP_KEY=branchkey PARENT_APP_KEY=parentkey AWS_S3_BUCKET=test-bucket npm run dev 2>&1 | head -30
```
Expected: log line `Storage initialized in branch mode { appKey: 'branchkey', parentAppKey: 'parentkey' }`. Stop with Ctrl-C.

- [ ] **Step 3: Commit**

```bash
git add backend/src/services/storage/storage.service.ts
git commit -m "feat(branching): wire PARENT_APP_KEY through to S3 provider"
```

---

## Task 5: Manual Smoke Test

- [ ] **Step 1: Two-namespace smoke against real S3**

Pre-requisites: AWS creds + a test bucket with two prefixes:
- `parentkey/photos/cat.jpg` (some real file)
- `branchkey/photos/dog.jpg` (some other real file)

```bash
# Branch mode boot
APP_KEY=branchkey PARENT_APP_KEY=parentkey AWS_S3_BUCKET=insforge-storage-test \
  AWS_REGION=us-east-2 npm run dev:backend
```

Then in another terminal (after seeding `storage.objects` rows so RLS allows access):

```bash
# Should hit branch (own file)
curl -i http://localhost:7130/api/storage/buckets/photos/objects/dog.jpg

# Should hit parent (fallback)
curl -i http://localhost:7130/api/storage/buckets/photos/objects/cat.jpg

# Write goes to branch only
curl -i -X PUT http://localhost:7130/api/storage/buckets/photos/objects/new.txt \
  -H "Authorization: Bearer $TOKEN" --data-binary "branch-write"

# Verify on S3 directly
aws s3 ls s3://insforge-storage-test/branchkey/photos/   # contains new.txt
aws s3 ls s3://insforge-storage-test/parentkey/photos/   # unchanged
```

- [ ] **Step 2: Open PR**

```bash
git push -u origin feat/branching
gh pr create --title "feat: storage fallback to parent for branch projects" --body "$(cat <<'EOF'
## Summary
- Adds optional `PARENT_APP_KEY` env var that triggers read-only fallback in S3 storage provider.
- All read methods (getObject, headObject, getObjectStream, getPresignedUrl) try branch path first, fall back to parent path on 404.
- Writes are unchanged — they always target the branch's own appkey path.
- Local storage provider is unaffected (no fallback).

## Spec
- [docs/superpowers/specs/2026-04-29-backend-branching-oss-design.md](docs/superpowers/specs/2026-04-29-backend-branching-oss-design.md)

## Test plan
- [ ] Vitest suite green
- [ ] Manual: GET on branch object hits branch
- [ ] Manual: GET on parent-only object falls back to parent
- [ ] Manual: GET on missing object returns 404
- [ ] Manual: PUT on branch creates only at branch path
- [ ] Manual: existing non-branch projects (no PARENT_APP_KEY) are unaffected

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```

---

## Self-Review Notes

- **Fallback is read-only**: writes (PUT/DELETE/multipart) always go to branch path. Verified by not modifying any write methods.
- **Local provider unchanged**: only S3 provider gets the fallback. Local installs aren't branched.
- **No HTTP API changes**: routes and middleware unchanged. RLS / bucket-visibility checks remain authoritative.
- **No new IAM permissions**: existing role can read all prefixes in `AWS_S3_BUCKET`.
- **Schema-only mode**: branches with `mode='schema-only'` truncate `storage.objects` in the DB → RLS lookup returns 404 before reaching the provider → fallback never runs. Documented in spec as expected.
