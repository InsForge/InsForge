# S3-Compatible Storage Gateway

## Overview

Add an S3-protocol HTTP gateway in front of InsForge's Storage module so that any AWS S3-compatible client (`aws` CLI, `rclone`, AWS SDKs, Terraform, backup tools) can read and write InsForge buckets with no code changes.

The gateway sits at `/storage/v1/s3` on each project's backend host (e.g. `{appkey}.{region}.insforge.app/storage/v1/s3`). It verifies AWS SigV4 signatures against project-scoped access keys, dispatches to a small set of S3 operation handlers, and delegates physical IO to the existing `S3StorageProvider`. Object and bucket metadata stays consistent with the REST API by sharing the `storage.buckets` and `storage.objects` tables.

## Motivation

InsForge today exposes only a REST API for storage. Developers who want to migrate existing S3-based workloads (CI upload steps, `aws s3 sync`, backup scripts, Terraform `aws_s3_object` resources) have to rewrite their integration. Supabase shipped an S3-compatible gateway for the same reason; open-sourcing that design ([supabase/storage](https://github.com/supabase/storage)) means a well-trodden implementation path exists. This feature closes the compatibility gap so that InsForge Storage becomes drop-in usable from any S3 toolchain.

## Goals & Non-Goals

### Goals (v1)

1. `aws s3 cp <file> s3://<bucket>/<key>` and the reverse work zero-config (including files >200 MB via automatic multipart).
2. `aws s3 sync` and `rclone sync` work bidirectionally.
3. Objects uploaded via S3 protocol appear immediately in the InsForge Dashboard and REST API `GET /api/storage/buckets/:bucket/objects`. Reverse direction works too.
4. Secret access keys are never exposed after creation; the DB stores only encrypted ciphertext.
5. Large uploads stream end-to-end; memory usage does not scale with object size.

### Non-Goals (v1)

- Presigned URLs (query-string auth) for GET or PUT. Users wanting browser direct uploads use the existing REST `POST /api/storage/buckets/:bucket/upload-strategy`.
- Session-token auth (user-JWT-scoped S3 access, Supabase-style `sessionToken` via `X-Amz-Security-Token`). v1 only supports the project-admin-level `storage.s3_access_keys` credentials. See Open Question 7.
- Support for the `LocalStorageProvider` backend. The gateway refuses to mount if the backend is local; self-hosted users who want S3 protocol run MinIO and point `AWS_S3_BUCKET` + `S3_ENDPOINT_URL` at it.
- Virtual-hosted-style URLs (`{bucket}.endpoint/...`). Only path-style (`endpoint/{bucket}/{key}`).
- Signature V2.
- S3 governance features: versioning, SSE-C / SSE-KMS, ACLs, bucket policy, object lock, tagging, lifecycle, replication, inventory, analytics, CORS config.
- S3 event notifications.

## Architecture

### Endpoint & Routing

- External endpoint: `https://{appkey}.{region}.insforge.app/storage/v1/s3`
- SDK configuration: `{ endpoint, region: 'us-east-2', forcePathStyle: true, credentials }`
- Signature region defaults to `us-east-2` to match the region our `S3StorageProvider` uses by default (see `s3.provider.ts`), so requests forwarded to the underlying S3 don't need a separate region translation step. The validated region comes from `AWS_REGION` — the same env var the S3 provider already reads — so clients sign with the same region the backing bucket lives in, and the Dashboard's S3 Config page (`GET /api/storage/s3/config`) surfaces exactly what the middleware will accept.
- Mount path is `/storage/v1/s3` with **no `/api` prefix**. The `/api` prefix would force clients to configure `endpoint=<host>/api`, breaking S3 tooling conventions.

### Request Lifecycle

```text
Client (aws CLI / SDK / rclone)
   │  PUT /storage/v1/s3/my-bucket/photo.jpg
   │  Authorization: AWS4-HMAC-SHA256 Credential=AK.../us-east-2/s3/aws4_request ...
   │  x-amz-content-sha256: STREAMING-AWS4-HMAC-SHA256-PAYLOAD
   ▼
[1] Express app — `/storage/v1/s3/*` mounted BEFORE express.json() body parser.
   ▼
[2] SigV4 Middleware
   │  - Parse Authorization header → AccessKeyId
   │  - Lookup via LRU cache → storage.s3_access_keys row → decrypt secret
   │  - Verify header signature (clock skew, canonical request, string-to-sign, HMAC chain)
   │  - For STREAMING-* requests, only header verification happens here; body verification
   │    happens chunk-by-chunk as the stream is consumed downstream.
   │  - Asynchronously update last_used_at (fire and forget).
   ▼
[3] S3 Router — dispatch by (method, path shape, query string, headers).
   │  Examples: PUT /{bucket}/{key}?partNumber=N&uploadId=X → UploadPart;
   │            POST /{bucket}?delete → DeleteObjects.
   ▼
[4] Operation Handler (one file per op)
   │  - Delegates physical IO to S3StorageProvider (extended).
   │  - Reads/writes metadata via StorageService against storage.objects / storage.buckets.
   ▼
[5] Response Serializer
   │  - 2xx: status + S3-style headers (ETag, Content-Length, ...); ListXxx responds with XML.
   │  - Error: <Error><Code>...</Code>...</Error> XML via shared error helper.
```

### Module Layout

```text
backend/src/
├── api/
│   ├── middlewares/
│   │   └── s3-sigv4.ts                 # SigV4 verification middleware + LRU cache
│   └── routes/
│       ├── s3-gateway/                 # NEW
│       │   ├── index.routes.ts         # mount + method/path/query dispatch
│       │   ├── commands/               # one file per S3 op (14 ops + 2 stubs)
│       │   ├── xml.ts                  # XML serialization via xml2js
│       │   └── errors.ts               # S3 error code → XML response
│       └── storage/
│           └── index.routes.ts         # EXTENDED with /s3/access-keys CRUD subroutes
├── services/
│   └── storage/
│       ├── s3-access-key.service.ts    # NEW — key CRUD, encryption, LRU cache
│       ├── s3-signature.ts             # NEW — SigV4 algorithm (header + chunked stream)
│       └── storage.service.ts          # EXTENDED — multipart-aware methods
└── providers/
    └── storage/
        ├── base.provider.ts            # EXTENDED interface
        └── s3.provider.ts              # implements new methods
```

### Responsibility Boundaries

| Concern | Owner | Rationale |
|---|---|---|
| SigV4 verification and op dispatch | `s3-sigv4` middleware + router | Isolated from business logic, unit-testable. |
| S3 op semantics (Put/Get/List/…) | `commands/*.ts` (one per op) | Keeps each file small and single-purpose. |
| Physical object IO | `S3StorageProvider` | Only place that instantiates `S3Client`. |
| Object metadata read/write | `StorageService` | Shared with REST path; prevents format drift. |
| XML serialization | `xml.ts` | Consistent formatting across operations. |

### Body Parser Ordering

`server.ts` currently does:

```ts
app.use(express.json({ limit: '100mb' }));
app.use('/api', apiRouter);
```

This must change to mount the S3 router **before** any body-consuming middleware:

```ts
app.use('/storage/v1/s3', s3GatewayRouter);  // streaming-aware, never calls express.json()

app.use(express.json({ limit: '100mb' }));
app.use('/api', apiRouter);
```

The S3 router handles `req` as a Readable stream directly and never consumes the body via `bodyParser` / `multer`.

## Access Key Model

### Database

Migration `033_create-s3-access-keys.sql`:

```sql
CREATE TABLE IF NOT EXISTS storage.s3_access_keys (
  id                           UUID        DEFAULT gen_random_uuid() PRIMARY KEY,
  access_key_id                TEXT        NOT NULL UNIQUE,
  secret_access_key_encrypted  TEXT        NOT NULL,
  description                  TEXT,
  created_at                   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_used_at                 TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_s3_access_keys_last_used_at
  ON storage.s3_access_keys (last_used_at);
```

Table lives in the `storage` schema alongside `storage.buckets`, `storage.objects`, `storage.config`. No `app_key` column (one project per process). No `updated_at` (keys are immutable — modify by destroy + recreate). No foreign key to users (keys are project-scoped, not user-scoped).

### Credential Format

| Field | Format | Length | Example |
|---|---|---|---|
| `access_key_id` | `INSF` prefix + 16 upper-case alphanumeric | 20 | `INSFABC123DEF456GH78` |
| `secret_access_key` | 40 base64url chars (from 30 random bytes, stripped of padding) | 40 | `x7K2-a_pL9qRs4N8vYzWcE1fH5gJ3mUtBoD6ViXk` |

Lengths match AWS conventions (20 / 40) to avoid SDK validation errors. Both fields are generated with `crypto.randomBytes` and then formatted. Base64url alphabet (`A–Z a–z 0–9 - _`) is chosen because AWS SigV4 puts the access key id into the canonical request as-is; any character outside `unreserved` would need URI-encoding handling in our own verifier.

### Secret Storage

The `secret_access_key_encrypted` column stores `EncryptionManager.encrypt()` output (AES-256-GCM), reversible because SigV4 verification requires the raw secret to recompute HMAC signatures. The encryption key comes from the existing `ENCRYPTION_KEY` env var. Rotating `ENCRYPTION_KEY` invalidates all stored secrets and requires users to recreate keys — documented behaviour.

### Constraints

- Hard cap of **50 keys per project**. `S3AccessKeyService.create` performs the count check and the insert inside a single SERIALIZABLE transaction, so concurrent creations cannot both pass the check and overshoot the cap. Over-limit returns `400 S3_ACCESS_KEY_LIMIT_EXCEEDED`.
- Keys are immutable. No update endpoint.
- Plaintext secret is returned **only once** in the creation response. Subsequent `GET` calls never return the secret.
- `last_used_at` updated asynchronously on each successful SigV4 verification via `setImmediate` (fire-and-forget, errors swallowed to avoid blocking the request).

### Management API

Mounted under the existing `storageRouter`, protected by `verifyAdmin`:

| Method | Path | Purpose |
|---|---|---|
| `POST` | `/api/storage/s3/access-keys` | Create; body `{ description? }`; response contains plaintext secret (once). |
| `GET` | `/api/storage/s3/access-keys` | List (no secrets). |
| `DELETE` | `/api/storage/s3/access-keys/:id` | Delete; LRU cache invalidated synchronously. |

Audit events: `CREATE_S3_ACCESS_KEY`, `DELETE_S3_ACCESS_KEY`.

### Runtime Cache

SigV4 verification is on the hot path (every S3 request). Pure DB lookup would be a bottleneck.

- In-process LRU keyed by `access_key_id`, value `{ secret_plaintext, id }`.
- Size 1024 entries (well above the 50-key cap, so effectively never evicts) with 5-minute TTL (bounds staleness after delete).
- Synchronous invalidation on delete.
- Implementation: `lru-cache` npm package. (Already a transitive dep of AWS SDK; if not in lockfile, added directly.)

### Authorization Semantics

A valid S3 credential in its project grants:
- Read and write on **all** buckets, ignoring `public`/`private` flags (those apply to anonymous access; credential holders are not anonymous).
- `CreateBucket` / `DeleteBucket`.
- No cross-project access possible — physical process isolation enforces this.

S3-protocol uploads record the originating access key via the new `s3_access_key_id` column on `storage.objects` (see Schema Extensions below). `uploaded_by` is `NULL` on S3-protocol uploads — we do not overload that UUID column with a string marker.

## Request Handling Pipeline

### Express Mount Order

Already covered above: `/storage/v1/s3` router mounts before `express.json()`.

### SigV4 Header-Signed Requests

AWS SigV4 (the short form):

1. Parse `Authorization: AWS4-HMAC-SHA256 Credential=<ak>/<date>/<region>/s3/aws4_request, SignedHeaders=<sorted;list>, Signature=<sig>`.
2. Look up credential (cache, then DB) → plaintext secret.
3. Build **Canonical Request**. The `<URI-encoded path>` MUST be derived from the raw, percent-encoded request path as the client sent it (e.g. `req.originalUrl` in Express), **not** a URL-decoded representation — otherwise object keys containing percent-encoded characters produce signature mismatches.
   ```text
   <METHOD>\n
   <URI-encoded path>\n
   <canonical query>\n
   <canonical headers>\n
   \n
   <signed headers list>\n
   <x-amz-content-sha256 value>
   ```
4. Build **String-to-Sign**: `AWS4-HMAC-SHA256\n<datetime>\n<scope>\nSHA256(canonical request)`.
5. Derive signing key: `HMAC(HMAC(HMAC(HMAC("AWS4"+secret, date), region), "s3"), "aws4_request")`.
6. Compute `HMAC(signingKey, stringToSign)`, compare to client signature with `crypto.timingSafeEqual`. Length mismatch → return `SignatureDoesNotMatch` without invoking timing-safe comparison.
7. For requests with a hashed body (not `UNSIGNED-PAYLOAD`, not `STREAMING-*`), additionally verify `SHA-256(body) === x-amz-content-sha256` header.

### SigV4 Streaming (Chunked) Requests

Triggered by `x-amz-content-sha256: STREAMING-AWS4-HMAC-SHA256-PAYLOAD`. Body structure:

```text
<chunk1-size-hex>;chunk-signature=<sig1>\r\n
<chunk1-payload>\r\n
<chunk2-size-hex>;chunk-signature=<sig2>\r\n
<chunk2-payload>\r\n
...
0;chunk-signature=<final-sig>\r\n
\r\n
```

Verification is streamed, not buffered:

1. Verify header signature as above; the canonical-request body hash is the literal `STREAMING-AWS4-HMAC-SHA256-PAYLOAD`. The computed header signature is the `seed_signature` for chunk verification.
2. Pipe `req` through a `ChunkSignatureV4Parser` Transform with states `HEADER → DATA → CRLF → HEADER → …`:
   - Parse chunk header; record declared chunk size and signature.
   - Stream incoming bytes into a running `crypto.createHash('sha256')` while pushing them downstream.
   - At end of DATA: compose chunk string-to-sign = `AWS4-HMAC-SHA256-PAYLOAD\n<datetime>\n<scope>\n<previous_signature>\n<SHA256("")>\n<SHA256(chunk_payload)>`, HMAC-verify, compare to declared signature.
   - Chain: the first chunk's `previous_signature` is the header's `seed_signature`; each subsequent chunk uses the previous chunk's signature.
3. Downstream (the `Body` parameter of `PutObjectCommand` / `UploadPartCommand`) receives only verified payload bytes.
4. Any chunk signature mismatch: destroy the stream, return `SignatureDoesNotMatch` (403) XML error.

A `SegmentedBufferQueue` keeps header parsing memory bounded; chunk header length is capped at 128 bytes to prevent pathological allocations.

### Operation Dispatch

S3 keys off (method, path shape, query string, and sometimes headers). The dispatcher maps to command handlers:

| Method | Path | Query / Header | Op |
|---|---|---|---|
| `PUT` | `/{bucket}/{key}` | — | PutObject |
| `PUT` | `/{bucket}/{key}` | `?partNumber=N&uploadId=X` | UploadPart |
| `PUT` | `/{bucket}/{key}` | header `x-amz-copy-source` | CopyObject |
| `POST` | `/{bucket}/{key}` | `?uploads` | CreateMultipartUpload |
| `POST` | `/{bucket}/{key}` | `?uploadId=X` | CompleteMultipartUpload |
| `POST` | `/{bucket}` | `?delete` | DeleteObjects |
| `DELETE` | `/{bucket}/{key}` | — | DeleteObject |
| `DELETE` | `/{bucket}/{key}` | `?uploadId=X` | AbortMultipartUpload |
| `GET` | `/{bucket}/{key}` | — | GetObject |
| `GET` | `/{bucket}/{key}` | `?uploadId=X` | ListParts |
| `GET` | `/{bucket}` | — / `?list-type=2` | ListObjectsV2 |
| `GET` | `/` | — | ListBuckets |
| `HEAD` | `/{bucket}/{key}` | — | HeadObject |
| `HEAD` | `/{bucket}` | — | HeadBucket |
| `PUT` | `/{bucket}` | — | CreateBucket |
| `DELETE` | `/{bucket}` | — | DeleteBucket |

Implementation is a single `dispatch(req)` function, not Express's per-verb router, because the path shapes conflict (`/bucket/key` vs `/bucket` vs `/`).

### Path Parsing

- Express mounts at `/storage/v1/s3`, so `req.path` is `/{bucket}/{key}` or `/{bucket}/` or `/`.
- First segment → bucket name; remainder → object key.
- Bucket name validation reuses the existing regex `^[a-zA-Z0-9_-]+$`.
- Key validation rejects `..` and leading `/` (same rules as the REST layer).

### Clock Skew Protection

`X-Amz-Date` is compared to server time with a tolerance of **15 minutes** (AWS standard). Out-of-range returns `RequestTimeTooSkewed` before signature comparison.

## Provider Extensions & Metadata Sync

### `StorageProvider` Interface Additions

```ts
interface StorageProvider {
  // ...existing methods kept

  putObjectStream(
    bucket: string,
    key: string,
    body: Readable,
    opts: { contentType?: string; contentLength?: number }
  ): Promise<{ etag: string; size: number }>;

  headObject(bucket: string, key: string): Promise<{
    size: number;
    etag: string;
    contentType?: string;
    lastModified: Date;
  } | null>;

  copyObject(
    srcBucket: string, srcKey: string,
    dstBucket: string, dstKey: string
  ): Promise<{ etag: string; lastModified: Date }>;

  getObjectStream(
    bucket: string,
    key: string,
    opts?: { range?: string }
  ): Promise<{
    body: Readable;
    size: number;
    etag: string;
    contentType?: string;
    lastModified: Date;
  }>;

  createMultipartUpload(
    bucket: string, key: string, opts: { contentType?: string }
  ): Promise<{ uploadId: string }>;

  uploadPart(
    bucket: string, key: string, uploadId: string,
    partNumber: number, body: Readable, contentLength: number
  ): Promise<{ etag: string }>;

  completeMultipartUpload(
    bucket: string, key: string, uploadId: string,
    parts: Array<{ partNumber: number; etag: string }>
  ): Promise<{ etag: string; size: number }>;

  abortMultipartUpload(bucket: string, key: string, uploadId: string): Promise<void>;

  listParts(
    bucket: string, key: string, uploadId: string,
    opts: { maxParts?: number; partNumberMarker?: number }
  ): Promise<{
    parts: Array<{ partNumber: number; etag: string; size: number; lastModified: Date }>;
    isTruncated: boolean;
    nextPartNumberMarker?: number;
  }>;
}
```

### LocalStorageProvider Behavior

All new methods throw:

```ts
throw new AppError(
  'S3 protocol requires an S3 storage backend. Set AWS_S3_BUCKET (and optionally S3_ENDPOINT_URL for MinIO).',
  501, ERROR_CODES.NOT_IMPLEMENTED
);
```

At startup, the gateway detects the active provider. If not `S3StorageProvider`, mount a stub router at `/storage/v1/s3` that returns a 501 S3 XML error for every request.

### S3StorageProvider Implementation

Each new method is a thin wrapper over an AWS SDK v3 command, reusing the existing `getS3Key(bucket, key)` helper that applies the `{appKey}/{bucket}/{key}` prefix. Multipart operations use real S3 multipart (uploadId is the real S3 uploadId); InsForge stores no multipart state in its own DB.

### Metadata Synchronization Table

| Op | S3 action | DB action |
|---|---|---|
| `PutObject` | `PutObjectCommand` (streaming) | `INSERT ... ON CONFLICT (bucket, key) DO UPDATE` |
| `GetObject` | `GetObjectCommand` stream | Read metadata from `storage.objects` |
| `HeadObject` | — | Read from `storage.objects` |
| `DeleteObject` | `DeleteObjectCommand` | `DELETE FROM storage.objects WHERE bucket=$1 AND key=$2` |
| `DeleteObjects` | Parallel `DeleteObjectCommand`s | Single `DELETE ... WHERE (bucket, key) IN (...)` |
| `CopyObject` | `CopyObjectCommand` (server-side) | `INSERT` destination row |
| `CreateMultipartUpload` | `CreateMultipartUploadCommand` | None |
| `UploadPart` | `UploadPartCommand` (streaming) | None |
| `CompleteMultipartUpload` | `CompleteMultipartUploadCommand` | `INSERT ... ON CONFLICT DO UPDATE` with final size + ETag |
| `AbortMultipartUpload` | `AbortMultipartUploadCommand` | None |
| `CreateBucket` | `S3StorageProvider.createBucket` | `INSERT INTO storage.buckets (name, public) VALUES ($1, false)` |
| `DeleteBucket` | `S3StorageProvider.deleteBucket` | Check empty first; `DELETE FROM storage.buckets ...` |
| `ListObjectsV2` | — | Query `storage.objects` |
| `ListBuckets` | — | Query `storage.buckets` |
| `HeadBucket` | — | Query `storage.buckets` |

List operations read from the DB, not live S3, because the DB is the source of truth for object metadata.

### Schema Extensions for `storage.objects`

Migration `034_extend-storage-objects-for-s3-protocol.sql`:

```sql
ALTER TABLE storage.objects
  ADD COLUMN IF NOT EXISTS uploaded_via TEXT NOT NULL DEFAULT 'rest'
    CHECK (uploaded_via IN ('rest', 's3', 'dashboard')),
  ADD COLUMN IF NOT EXISTS s3_access_key_id TEXT,
  ADD COLUMN IF NOT EXISTS etag TEXT;
```

- Existing REST/Dashboard upload paths write `uploaded_via='rest'` or `'dashboard'`, leave `s3_access_key_id` NULL.
- S3 gateway writes `uploaded_via='s3'`, `s3_access_key_id=<ak>`, `uploaded_by=NULL`.
- `etag` populated for all future uploads so HeadObject does not need to fall back to live S3.
- `uploaded_by` column stays; its type is unchanged. S3 writes use NULL there.

### ListObjectsV2 Implementation Notes

- Query params parsed: `prefix`, `delimiter`, `continuation-token`, `start-after`, `max-keys` (capped at 1000; default 1000).
- Base query: `SELECT key, size, mime_type, etag, uploaded_at FROM storage.objects WHERE bucket=$1 AND key LIKE $prefix||'%' [AND key > $start_after] ORDER BY key LIMIT $max_keys+1`.
- The `+1` detects truncation without a second query.
- `delimiter='/'`: common-prefix rollup done in application code after SELECT (SQL approach is brittle across edge cases).
- `continuation-token`: base64-encoded last returned key.

## Operation Scope (v1)

### Implemented

**Bucket-level (5):** `ListBuckets`, `CreateBucket`, `DeleteBucket`, `HeadBucket`, `ListObjectsV2`.

**Object-level (11):** `PutObject`, `GetObject`, `HeadObject`, `DeleteObject`, `DeleteObjects` (batch), `CopyObject`, `CreateMultipartUpload`, `UploadPart`, `CompleteMultipartUpload`, `AbortMultipartUpload`, `ListParts`.

**Stubs (2):** `GetBucketLocation` returns `<LocationConstraint>us-east-2</LocationConstraint>`; `GetBucketVersioning` returns `<VersioningConfiguration><Status>Disabled</Status></VersioningConfiguration>`. Both are commonly probed by SDKs on client init.

### Explicitly Rejected (return `NotImplemented` 501)

`GetBucketAcl`, `PutBucketAcl`, `GetBucketCors`, `PutBucketCors`, `GetObjectTagging`, `PutObjectTagging`, `GetObjectAcl`, `PutObjectAcl`, `UploadPartCopy`, and all versioning / lifecycle / replication / inventory endpoints.

### Bucket Name Rules

`CreateBucket` applies the existing InsForge regex `^[a-zA-Z0-9_-]+$`. This is looser than AWS's DNS-compatible rules (lowercase only, 3–63 chars, no underscores). Tradeoff: REST and S3 see the same rules, at the cost of occasional SDK-side warnings. Documented.

### Size Limits

- Single `PutObject`: 5 GB (AWS cap). Enforced via `Content-Length`; over-limit returns `EntityTooLarge` 400.
- `UploadPart`: 5 MB min (except last part), 5 GB max.
- Total multipart object: 5 TB (enforced by real S3, we pass-through the error).
- Optional env var `S3_PROTOCOL_MAX_OBJECT_SIZE_GB` can **lower** the per-object cap below 5 GB for a given deployment (abuse protection). It cannot raise the ceiling above the AWS single-PutObject max of 5 GB. Default: unset (i.e. the 5 GB cap applies). Does not relate to REST-layer `storage.config.max_file_size_mb`.

## Error Handling

All non-2xx responses return S3-format XML:

```xml
<?xml version="1.0" encoding="UTF-8"?>
<Error>
  <Code>NoSuchKey</Code>
  <Message>The specified key does not exist.</Message>
  <Resource>/my-bucket/photo.jpg</Resource>
  <RequestId>...</RequestId>
</Error>
```

### Error Code Map

| Internal condition | S3 code | HTTP |
|---|---|---|
| Signature mismatch | `SignatureDoesNotMatch` | 403 |
| Access key missing or deleted | `InvalidAccessKeyId` | 403 |
| Clock skew > 15 min | `RequestTimeTooSkewed` | 403 |
| Malformed Authorization header | `AuthorizationHeaderMalformed` | 400 |
| Bucket missing | `NoSuchBucket` | 404 |
| Object missing | `NoSuchKey` | 404 |
| Bucket already exists | `BucketAlreadyOwnedByYou` | 409 |
| Non-empty on DeleteBucket | `BucketNotEmpty` | 409 |
| Invalid bucket name | `InvalidBucketName` | 400 |
| Body exceeds single-object limit | `EntityTooLarge` | 400 |
| Multipart part too small | `EntityTooSmall` | 400 |
| Unsupported operation | `NotImplemented` | 501 |
| Anything else | `InternalError` | 500 |

Shared helper `sendS3Error(res, code, message, requestId)` in `s3-gateway/errors.ts`. `RequestId` = `crypto.randomUUID()` generated per request and echoed into audit / access logs.

## Security

- Secret exposure surface is exactly one response (create). Secrets are never logged; request/response logging scrubs the `secret_access_key_encrypted` column. LRU cache lives only in memory; process restart clears it.
- Rate limiting: the S3 path is excluded from `express-rate-limit` for request-level throttling (because streaming uploads would misfire). Instead, per-access-key throttling is applied in the SigV4 middleware.
- Audit: `CREATE_S3_ACCESS_KEY` / `DELETE_S3_ACCESS_KEY` go to `AuditService`. Data-plane S3 operations are not audited (volume is prohibitive); access logs are sufficient.
- Encryption key rotation: rotating `ENCRYPTION_KEY` invalidates stored secrets. Users must recreate keys. Behaviour documented.

## Testing Strategy

Testing is co-equal with implementation — the quality gate for "S3-compatible".

1. **SigV4 unit tests** using AWS's published `aws4_testsuite` fixtures (canonical request / string-to-sign / signature triples hardcoded, compared to our implementation).
2. **Integration tests (CI)**: run the backend against MinIO via docker-compose. Exercise the full op surface via `@aws-sdk/client-s3`: Put/Get/Head small + large + multipart, ListObjectsV2 with pagination / prefix / delimiter, Copy, Delete, DeleteObjects.
3. **CLI black-box tests (manual at minimum, scripted in CI where feasible)**:
   - `aws s3 cp` — 100 KB, 100 MB, 1 GB (forces multipart).
   - `aws s3 sync` — both directions.
   - `aws s3 rm --recursive`.
   - `rclone copy` and `rclone sync`.
4. **Negative tests**: wrong signature, expired date, deleted access key, non-existent bucket/key, DeleteBucket on non-empty bucket.

Tests live under `backend/tests/s3-gateway/`.

## Risk Register

| Risk | Severity | Mitigation |
|---|---|---|
| SigV4 implementation bug breaks some SDKs | High | Port-by-line from Supabase's `signature-v4.ts`; compliance test suite covers aws-cli / aws-sdk-js / boto3 / rclone. |
| Streaming chunk parser state-machine bug corrupts uploads or leaks memory | High | Unit tests cover chunk-size boundaries (exact, multi-packet, equal to highWaterMark); `byte-limit-stream` caps per-request size. |
| `storage.objects` and real S3 drift (S3 write succeeds, DB write fails) | Medium | Write S3 first, then DB; on DB failure, compensating S3 delete; periodic reconcile job. |
| Mount order regression swallows raw body via `express.json()` | Medium | Integration test that streams a 10 MB body through to verify chunks arrive; code-review checklist. |
| Hot access key causes DB contention | Medium | LRU cache + single-flight mutex on cache miss. |
| `crypto.timingSafeEqual` throws on length mismatch | Low | Length check before call; mismatched length returns `SignatureDoesNotMatch`. |
| Client with wrong region signature slips through | Low | Validate `Credential` scope's region field equals `us-east-2`. |
| Noise from unsupported presigned-URL failures | Low | Docs explicitly redirect users to REST `upload-strategy`. |
| Credential enumeration / DoS | Low | 50-key hard cap; per-access-key rate limit. |

## Open Questions

These are parked; they don't block the design but should be resolved during or before implementation.

1. **Dashboard UI** for S3 access key management. Scope-excluded from this design; tracked as a separate spec / PR.
2. **`storage.objects.etag` backfill.** Existing rows need `etag` populated (either lazily on first HeadObject or via migration backfill). Lazy is simpler, migration is more consistent — decide during implementation.
3. **MinIO self-hosted support.** The design supports it by construction; should we document and recommend it as the self-hosted S3-protocol path? (Recommend: yes.)
4. **Updating existing REST/Dashboard upload paths** to write `uploaded_via='rest' | 'dashboard'`. Required to keep the new column meaningful. Non-breaking (has DEFAULT).
5. **Cross-project isolation** rests on the "one process = one app_key" deployment assumption. If the platform ever consolidates processes, this design needs revisiting. Add a code comment flagging the assumption.
6. **Host-based routing** (`{appkey}.{region}.insforge.app`) is an infrastructure-layer concern (ingress / DNS / ALB), not backend code. The design assumes it works; ingress config is out of scope for this spec.
7. **Session-token auth (user-JWT-scoped S3 access)** — Supabase supports a third credential shape `{accessKeyId: project_ref, secretAccessKey: anonKey, sessionToken: <user JWT>}` that lets S3 operations respect per-user permissions via Postgres RLS. Deliberately cut from v1:
    - The `storage.s3_access_keys` path covers the main server-side use cases (CI, scripts, backup tooling, rclone).
    - InsForge does not use Postgres RLS today; replicating Supabase's "DB filters by JWT" model would mean building an application-layer user-scoping policy on every S3 handler — a separate design problem with its own scope.
    - Browser direct uploads are already served by `POST /api/storage/buckets/:bucket/upload-strategy`.
    
    If added later, the shape should be: detect `X-Amz-Security-Token` in the SigV4 middleware, verify via `TokenManager.verifyToken()`, attach the user identity to `S3AuthContext`, and introduce a handler-layer policy (or bucket-visibility + ownership check) gating every operation. Needs its own spec.

## Tradeoffs Summary

**Pros**
- Aligned with Supabase's open-source protocol path; documentation and community experience transfer.
- Shared namespace means Dashboard and S3 protocol see the same objects — minimal user cognitive load.
- Single-tenant per process avoids multi-tenant routing work.
- Reuses existing infrastructure (`EncryptionManager`, `StorageService`, `S3StorageProvider`, migration framework).

**Cons**
- Implementation size is non-trivial (~2500–3500 lines of new code + tests).
- SigV4 chunked-payload parser is precision protocol work — bugs show up as "one SDK works, another doesn't".
- Presigned URLs cut from v1 for scope; adding them later touches the data plane.
- LocalStorageProvider users don't get S3 protocol; they must run MinIO.
