# Direct Deploy Flow Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implement and ship a manifest-based direct deployment flow that streams source files through InsForge to Vercel without exposing Vercel credentials, while preserving the legacy zip/S3 deployment path for backward compatibility.

**Architecture:** The backend exposes a direct deployment session endpoint that stores deployment rows in `deployments.runs`, stores manifest/upload state in `deployments.files`, and returns a `fileId` per entry. Clients then stream each file to `PUT /api/deployments/:id/files/:fileId/content`; InsForge validates the byte stream against the registered SHA/size and proxies it to Vercel's file upload API. Once every manifest row is marked uploaded, the client calls `POST /api/deployments/:id/start`, and InsForge creates the Vercel deployment from uploaded file SHAs. MCP uses the direct flow when the backend version supports it, and falls back to the legacy zip upload flow when the backend is older or returns `404`.

**Tech Stack:** Express, PostgreSQL, Zod shared schemas, Axios + node-fetch streaming, Vercel file upload API, React service layer, Docker Compose, Vitest, MCP server tooling

**Reference:** `docs/core-concepts/deployments/architecture.mdx`

---

## File Map

### InsForge repo

| File | Purpose |
|------|---------|
| `packages/shared-schemas/src/deployments-api.schema.ts` | Shared request/response contracts for direct deployment manifest, file upload response, and start payload |
| `backend/src/infra/database/migrations/031_create-deployment-files.sql` | Moves `system.deployments` to `deployments.runs` and creates `deployments.files` for direct upload tracking |
| `backend/src/types/deployments.ts` | Backend deployment status semantics used by both direct and legacy flows |
| `backend/src/api/routes/deployments/index.routes.ts` | HTTP entrypoints for legacy create, direct create, file upload, start, metadata, slug, and custom domains |
| `backend/src/services/deployments/deployment.service.ts` | Core orchestration for manifest validation, file upload proxying, direct-vs-legacy branching, and self-hosted Vercel support |
| `backend/src/providers/deployments/vercel.provider.ts` | Streaming file upload implementation against Vercel's `/v2/files` API |
| `backend/src/server.ts` | Global rate-limit bypass for the direct file upload endpoint |
| `backend/tests/unit/deployment-direct-flow.test.ts` | Service-level coverage for direct deployment session creation, upload validation, and self-hosted config behavior |
| `backend/tests/unit/vercel-upload-batching.test.ts` | Provider-level coverage for streaming uploads, 409 dedupe handling, and 429 retry semantics |
| `packages/dashboard/src/features/deployments/services/deployments.service.ts` | Client methods mirroring the direct deployment endpoints for future UI or SDK consumers |
| `.env.example` | Root sample env showing Vercel credentials required for self-hosted deployments |
| `docker-compose.yml` | Dev compose pass-through for Vercel credentials |
| `docker-compose.prod.yml` | Prod compose pass-through for Vercel credentials |
| `deploy/docker-compose/.env.example` | Packaged deployment sample env |
| `deploy/docker-compose/docker-compose.yml` | Packaged deployment compose pass-through |
| `docs/agent-docs/deployment.md` | Agent-facing deployment instructions |
| `docs/core-concepts/deployments/architecture.mdx` | Product/architecture documentation for both direct and legacy flows |

### MCP repo

| File | Purpose |
|------|---------|
| `../insforge-mcp/src/shared/tools/types.ts` | Register context carrying backend version into tool registration |
| `../insforge-mcp/src/shared/tools/index.ts` | Backend version discovery and tool registration |
| `../insforge-mcp/src/shared/tools/deployment.ts` | Direct deployment manifest collection, bounded parallel uploads, remote shell instructions, and legacy fallback |

---

## Task 1: Lock the shared contract and manifest persistence layer

**Files:**
- Modify: `packages/shared-schemas/src/deployments-api.schema.ts`
- Modify: `backend/src/infra/database/migrations/031_create-deployment-files.sql`
- Modify: `backend/src/types/deployments.ts`
- Test: `backend/tests/unit/deployment-direct-flow.test.ts`
- Test: `backend/tests/unit/deployment-schema-migration.test.ts`

- [ ] **Step 1: Add the direct deployment request/response schemas**

```ts
export const deploymentManifestFileEntrySchema = z.object({
  path: deploymentFilePathSchema,
  sha: z.string().regex(/^[a-f0-9]{40}$/i, 'sha must be a SHA-1 hex digest'),
  size: z.number().int().nonnegative(),
});

export const deploymentManifestFileSchema = deploymentManifestFileEntrySchema.extend({
  fileId: z.string().uuid(),
  uploadedAt: z.string().datetime().nullable(),
});

export const createDirectDeploymentRequestSchema = z
  .object({
    files: z.array(deploymentManifestFileEntrySchema).min(1),
  })
  .superRefine(({ files }, ctx) => {
    const firstSeenByPath = new Map<string, number>();

    files.forEach((file, index) => {
      const existingIndex = firstSeenByPath.get(file.path);
      if (existingIndex !== undefined) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: 'duplicate file path',
          path: ['files', index, 'path'],
        });
        return;
      }
      firstSeenByPath.set(file.path, index);
    });
  });

export const createDirectDeploymentResponseSchema = z.object({
  id: z.string().uuid(),
  status: deploymentSchema.shape.status,
  files: z.array(deploymentManifestFileSchema),
});

export const uploadDeploymentFileResponseSchema = deploymentManifestFileSchema.extend({
  uploadedAt: z.string().datetime(),
});
```

- [ ] **Step 2: Ensure migration 031 moves the published deployments table and creates resumable file tracking**

```sql
CREATE SCHEMA IF NOT EXISTS deployments;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM information_schema.tables
    WHERE table_schema = 'system' AND table_name = 'deployments'
  ) THEN
    ALTER TABLE system.deployments SET SCHEMA deployments;
  END IF;

  IF EXISTS (
    SELECT 1
    FROM information_schema.tables
    WHERE table_schema = 'deployments' AND table_name = 'deployments'
  ) AND NOT EXISTS (
    SELECT 1
    FROM information_schema.tables
    WHERE table_schema = 'deployments' AND table_name = 'runs'
  ) THEN
    ALTER TABLE deployments.deployments RENAME TO runs;
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS deployments.files (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  deployment_id UUID NOT NULL REFERENCES deployments.runs(id) ON DELETE CASCADE,
  file_path TEXT NOT NULL,
  sha TEXT NOT NULL CHECK (sha ~ '^[a-f0-9]{40}$'),
  size_bytes INTEGER NOT NULL CHECK (size_bytes >= 0),
  uploaded_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE (deployment_id, file_path)
);

CREATE INDEX IF NOT EXISTS idx_deployment_files_deployment_id
  ON deployments.files(deployment_id);

CREATE INDEX IF NOT EXISTS idx_deployment_files_uploaded_at
  ON deployments.files(deployment_id, uploaded_at);

DROP TRIGGER IF EXISTS update_system_deployments_updated_at ON deployments.runs;
DROP TRIGGER IF EXISTS update_deployments_updated_at ON deployments.runs;
DROP TRIGGER IF EXISTS update_runs_updated_at ON deployments.runs;
CREATE TRIGGER update_runs_updated_at BEFORE UPDATE ON deployments.runs
FOR EACH ROW EXECUTE FUNCTION system.update_updated_at();

DROP TRIGGER IF EXISTS update_system_deployment_files_updated_at ON deployments.files;
DROP TRIGGER IF EXISTS update_deployment_files_updated_at ON deployments.files;
DROP TRIGGER IF EXISTS update_files_updated_at ON deployments.files;
CREATE TRIGGER update_files_updated_at BEFORE UPDATE ON deployments.files
FOR EACH ROW EXECUTE FUNCTION system.update_updated_at();
```

- [ ] **Step 3: Add failing service tests that pin the contract**

```ts
it('creates a direct deployment and stores its manifest in one transaction', async () => {
  const service = DeploymentService.getInstance();

  const result = await service.createDirectDeployment({
    files: [{ path: 'src/index.ts', sha: 'A'.repeat(40), size: 12 }],
  });

  expect(result.status).toBe(DeploymentStatus.WAITING);
  expect(result.files[0]).toMatchObject({
    path: 'src/index.ts',
    sha: 'a'.repeat(40),
    size: 12,
    uploadedAt: null,
  });
});

it('rejects duplicate manifest paths before opening a transaction', async () => {
  const service = DeploymentService.getInstance();

  await expect(
    service.createDirectDeployment({
      files: [
        { path: 'src/index.ts', sha: 'a'.repeat(40), size: 12 },
        { path: 'src/index.ts', sha: 'b'.repeat(40), size: 13 },
      ],
    })
  ).rejects.toMatchObject({
    statusCode: 400,
    code: 'INVALID_INPUT',
  });
});
```

- [ ] **Step 4: Run the targeted backend test to verify the contract is red first, then green after implementation**

```bash
cd /Users/lyu/Documents/GitHub/InsForge/backend
npm test -- deployment-direct-flow.test.ts
```

Expected before backend implementation: failure around missing direct deployment behavior or schema mismatch  
Expected after Task 2: `Test Files  1 passed`

- [ ] **Step 5: Commit**

```bash
cd /Users/lyu/Documents/GitHub/InsForge
git add \
  packages/shared-schemas/src/deployments-api.schema.ts \
  backend/src/infra/database/migrations/031_create-deployment-files.sql \
  backend/src/types/deployments.ts \
  backend/tests/unit/deployment-direct-flow.test.ts
git commit -m "feat: add direct deployment manifest contracts"
```

---

## Task 2: Implement the backend direct upload proxy

**Files:**
- Modify: `backend/src/api/routes/deployments/index.routes.ts`
- Modify: `backend/src/services/deployments/deployment.service.ts`
- Modify: `backend/src/providers/deployments/vercel.provider.ts`
- Modify: `backend/src/server.ts`
- Test: `backend/tests/unit/deployment-direct-flow.test.ts`
- Test: `backend/tests/unit/vercel-upload-batching.test.ts`

- [ ] **Step 1: Add the direct deployment HTTP routes**

```ts
router.post('/direct', verifyAdmin, async (req, res, next) => {
  try {
    const validationResult = createDirectDeploymentRequestSchema.safeParse(req.body);
    if (!validationResult.success) {
      throw new AppError(
        validationResult.error.issues.map((e) => `${e.path.join('.')}: ${e.message}`).join(', '),
        400,
        ERROR_CODES.INVALID_INPUT
      );
    }

    const response = await deploymentService.createDirectDeployment(validationResult.data);
    successResponse(res, response, 201);
  } catch (error) {
    next(error);
  }
});

router.put('/:id/files/:fileId/content', verifyAdmin, async (req, res, next) => {
  try {
    const abortController = new AbortController();
    req.on('aborted', () => abortController.abort());
    res.on('close', () => {
      if (!res.writableEnded) abortController.abort();
    });

    const response = await deploymentService.uploadDeploymentFileContent(
      req.params.id,
      req.params.fileId,
      req,
      { signal: abortController.signal }
    );

    successResponse(res, response);
  } catch (error) {
    next(error);
  }
});
```

- [ ] **Step 2: Implement manifest registration, byte validation, and direct-vs-legacy start branching in the service**

```ts
async createDirectDeployment(
  input: CreateDirectDeploymentRequest
): Promise<CreateDirectDeploymentResponse> {
  this.assertDeploymentServiceConfigured();

  const files = this.validateDeploymentManifest(input.files);
  const totalSizeBytes = files.reduce((sum, file) => sum + file.size, 0);
  const client = await this.getPool().connect();

  try {
    await client.query('BEGIN');
    const deployment = await client.query(
      `INSERT INTO deployments.runs (provider, status, metadata)
       VALUES ($1, $2, $3)
       RETURNING
         id,
         provider_deployment_id as "providerDeploymentId",
         provider,
         status,
         url,
         metadata,
         created_at as "createdAt",
         updated_at as "updatedAt"`,
      [
        'vercel',
        DeploymentStatus.WAITING,
        JSON.stringify({
          uploadMode: 'direct',
          fileCount: files.length,
          totalSizeBytes,
          manifestCreatedAt: new Date().toISOString(),
        }),
      ]
    );
    const insertedFiles = await this.insertDeploymentFiles(client, deployment.rows[0].id, files);
    await client.query('COMMIT');

    return {
      id: deployment.rows[0].id,
      status: deployment.rows[0].status,
      files: insertedFiles.map((row) => this.toDeploymentFileResponse(row)),
    };
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    throw error;
  } finally {
    client.release();
  }
}

async uploadDeploymentFileContent(
  id: string,
  fileId: string,
  content: Readable,
  options: { signal?: AbortSignal } = {}
): Promise<UploadDeploymentFileResponse> {
  const deployment = await this.getDeploymentById(id);
  const file = await this.getDeploymentFileById(id, fileId);

  await this.vercelProvider.uploadFileStream({
    content: this.createValidatedFileStream(content, file.sha, file.size),
    sha: file.sha,
    size: file.size,
    signal: options.signal,
  });

  const uploadedFile = await this.markDeploymentFileUploaded(id, fileId);
  return {
    ...this.toDeploymentFileResponse(uploadedFile),
    uploadedAt: uploadedFile.uploadedAt.toISOString(),
  };
}

async startDeployment(id: string, input: StartDeploymentRequest = {}): Promise<DeploymentRecord> {
  const deployment = await this.getDeploymentById(id);
  const files = await this.getDeploymentFiles(id);
  const uploadMode = this.getUploadMode(deployment, files.length);

  if (uploadMode === 'direct') {
    return this.startDirectDeployment(id, input, files);
  }
  return this.startLegacyDeployment(id, input);
}
```

- [ ] **Step 3: Stream bytes to Vercel without buffering or automatic retry**

```ts
async uploadFileStream(input: {
  content: Readable;
  sha: string;
  size: number;
  signal?: AbortSignal;
}): Promise<string> {
  const credentials = await this.getCredentials();

  try {
    await axios.post(`https://api.vercel.com/v2/files?teamId=${credentials.teamId}`, input.content, {
      headers: {
        Authorization: `Bearer ${credentials.token}`,
        'Content-Type': 'application/octet-stream',
        'Content-Length': input.size.toString(),
        'x-vercel-digest': input.sha,
      },
      maxBodyLength: Infinity,
      maxContentLength: Infinity,
      signal: input.signal,
    });

    return input.sha;
  } catch (error) {
    if (axios.isAxiosError(error) && error.response?.status === 409) return input.sha;
    if (axios.isAxiosError(error) && error.response?.status === 429) {
      throw new AppError(
        'Vercel rate limit exceeded for file upload. Wait a moment and retry the file upload.',
        429,
        ERROR_CODES.RATE_LIMITED
      );
    }
    if (axios.isAxiosError(error) && error.code === 'ERR_CANCELED') {
      throw new AppError('Vercel file upload was interrupted.', 499, ERROR_CODES.INVALID_INPUT);
    }
    throw new AppError('Failed to upload file to Vercel', 500, ERROR_CODES.INTERNAL_ERROR);
  }
}
```

- [ ] **Step 4: Bypass the global Express rate limiter for per-file direct uploads**

```ts
function shouldSkipGlobalRateLimit(req: Request): boolean {
  if (req.path === '/api/health') {
    return true;
  }

  return (
    req.method === 'PUT' && /^\/api\/deployments\/[^/]+\/files\/[^/]+\/content$/.test(req.path)
  );
}
```

- [ ] **Step 5: Run focused backend verification**

```bash
cd /Users/lyu/Documents/GitHub/InsForge/backend
npm test -- deployment-direct-flow.test.ts
npm test -- vercel-upload-batching.test.ts
npm run build
```

Expected:
- `deployment-direct-flow.test.ts` passes
- `vercel-upload-batching.test.ts` passes
- `tsup` build succeeds

- [ ] **Step 6: Commit**

```bash
cd /Users/lyu/Documents/GitHub/InsForge
git add \
  backend/src/api/routes/deployments/index.routes.ts \
  backend/src/services/deployments/deployment.service.ts \
  backend/src/providers/deployments/vercel.provider.ts \
  backend/src/server.ts \
  backend/tests/unit/deployment-direct-flow.test.ts \
  backend/tests/unit/vercel-upload-batching.test.ts
git commit -m "feat: add direct deployment upload proxy"
```

---

## Task 3: Wire MCP local and remote deployment flows with compatibility fallback

**Files:**
- Modify: `../insforge-mcp/src/shared/tools/types.ts`
- Modify: `../insforge-mcp/src/shared/tools/index.ts`
- Modify: `../insforge-mcp/src/shared/tools/deployment.ts`

- [ ] **Step 1: Carry backend version through MCP tool registration context**

```ts
export interface RegisterContext {
  API_BASE_URL: string;
  backendVersion: string;
  isRemote: boolean;
  registerTool: RegisterToolFn;
  withUsageTracking: WithUsageTracking;
  getApiKey: GetApiKey;
  addBackgroundContext: AddBackgroundContext;
}
```

- [ ] **Step 2: Add direct deployment helpers with bounded parallel file uploads**

```ts
const DIRECT_DEPLOYMENT_MIN_VERSION = '2.0.4';
const DEFAULT_DIRECT_UPLOAD_CONCURRENCY = 8;
const MAX_DIRECT_UPLOAD_CONCURRENCY = 32;

async function deployDirect(
  API_BASE_URL: string,
  apiKey: string,
  sourceDirectory: string,
  startBody: StartDeploymentRequest
) {
  const files = await collectDeploymentFiles(sourceDirectory);
  const manifestFiles = files.map(({ path, sha, size }) => ({ path, sha, size }));
  const createResult = await createDirectDeploymentSession(API_BASE_URL, apiKey, manifestFiles);
  const localFileByPath = new Map(files.map((file) => [file.path, file] as const));
  const uploadConcurrency = getDirectUploadConcurrency();

  await runWithConcurrency(createResult.files, uploadConcurrency, async (file) => {
    const localFile = localFileByPath.get(file.path);
    await uploadDeploymentFileContent(API_BASE_URL, apiKey, createResult.id, file, localFile);
  });

  const startResult = await startDeployment(API_BASE_URL, apiKey, createResult.id, startBody);
  return { deploymentId: createResult.id, fileCount: files.length, uploadConcurrency, startResult };
}
```

- [ ] **Step 3: Prefer the direct flow when supported, but fall back to legacy zip on older backends or `404`**

```ts
const supportsDirectDeployment = supportsDirectDeploymentVersion(backendVersion);

if (supportsDirectDeployment) {
  try {
    const { fileCount, uploadConcurrency, startResult } = await deployDirect(
      API_BASE_URL,
      getApiKey(),
      resolvedSourceDir,
      startBody
    );

    return await addBackgroundContext({
      content: [
        {
          type: 'text',
          text:
            formatSuccessMessage('Deployment started', startResult) +
            `\n\nUploaded ${fileCount} files through direct deployment proxy with concurrency ${uploadConcurrency}.`,
        },
      ],
    });
  } catch (error) {
    if (!(error instanceof DirectDeploymentUnsupportedError)) {
      throw error;
    }
  }
}

// Fallback to the legacy zip + S3 path.
const createResponse = await fetch(`${API_BASE_URL}/api/deployments`, {
  method: 'POST',
  headers: {
    'x-api-key': getApiKey(),
    'Content-Type': 'application/json',
  },
});
```

- [ ] **Step 4: Return remote shell instructions that match the same direct flow**

```ts
return `Direct deployment upload is available for this backend.

Please execute the following command locally from a shell that has INSFORGE_API_KEY set, then call the \`start-deployment\` tool with the deployment ID printed by the script. Set \`INSFORGE_DEPLOY_UPLOAD_CONCURRENCY\` if you want to tune parallel uploads; the default is 8 and the maximum is 32.

\`\`\`bash
cd ${escapedDir}
INSFORGE_API_KEY="\${INSFORGE_API_KEY:?Set INSFORGE_API_KEY to your InsForge API key}" node --input-type=module <<'NODE'
const createResult = await api('/api/deployments/direct', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    files: localFiles.map(({ path, sha, size }) => ({ path, sha, size })),
  }),
});

await runWithConcurrency(createResult.files, uploadConcurrency, async (manifestFile) => {
  const localFile = localFileByPath.get(manifestFile.path);
  await uploadFile(createResult.id, manifestFile, localFile);
});

console.log('Deployment files uploaded. Deployment ID: ' + createResult.id);
NODE
\`\`\`

If the upload is interrupted after the deployment ID is printed, query \`deployments.files\` with the raw SQL tool for that \`deployment_id\` to inspect \`uploaded_at\`.`;
```

- [ ] **Step 5: Verify MCP compilation and smoke-test tool registration**

```bash
cd /Users/lyu/Documents/GitHub/insforge-mcp
npm test
npm run build
```

Expected:
- `vitest run --passWithNoTests` exits successfully
- `tsup` build succeeds

- [ ] **Step 6: Commit**

```bash
cd /Users/lyu/Documents/GitHub/insforge-mcp
git add \
  src/shared/tools/types.ts \
  src/shared/tools/index.ts \
  src/shared/tools/deployment.ts
git commit -m "feat: add direct deployment support to mcp"
```

---

## Task 4: Surface self-hosted configuration and document the new flow

**Files:**
- Modify: `packages/dashboard/src/features/deployments/services/deployments.service.ts`
- Modify: `.env.example`
- Modify: `docker-compose.yml`
- Modify: `docker-compose.prod.yml`
- Modify: `deploy/docker-compose/.env.example`
- Modify: `deploy/docker-compose/docker-compose.yml`
- Modify: `docs/agent-docs/deployment.md`
- Modify: `docs/core-concepts/deployments/architecture.mdx`

- [ ] **Step 1: Mirror the direct deployment endpoints in the dashboard service client**

```ts
async createDirectDeployment(
  data: CreateDirectDeploymentRequest
): Promise<CreateDirectDeploymentResponse> {
  return apiClient.request('/deployments/direct', {
    method: 'POST',
    headers: apiClient.withAccessToken(),
    body: JSON.stringify(data),
  });
}

async uploadDeploymentFileContent(
  id: string,
  fileId: string,
  content: Blob | ArrayBuffer
): Promise<UploadDeploymentFileResponse> {
  return apiClient.request(`/deployments/${id}/files/${fileId}/content`, {
    method: 'PUT',
    headers: {
      ...apiClient.withAccessToken(),
      'Content-Type': 'application/octet-stream',
    },
    body: content,
  });
}
```

- [ ] **Step 2: Add self-hosted Vercel credentials to the sample env and compose files**

```env
# Deployment Configuration (Optional)
# Required for self-hosted site deployments and custom domains.
VERCEL_TOKEN=
VERCEL_TEAM_ID=
VERCEL_PROJECT_ID=
```

```yaml
      # Deployment Configuration
      - VERCEL_TOKEN=${VERCEL_TOKEN:-}
      - VERCEL_TEAM_ID=${VERCEL_TEAM_ID:-}
      - VERCEL_PROJECT_ID=${VERCEL_PROJECT_ID:-}
```

- [ ] **Step 3: Document the direct flow and the legacy fallback explicitly**

```md
## Overview

Deploy frontend applications to InsForge using the `create-deployment` MCP tool. The tool handles uploading source files, building, and deploying automatically.
Source files are uploaded individually through InsForge's deployment proxy; do not zip the project or upload deployment artifacts to storage yourself.
The REST API still supports the legacy zip upload flow for backward compatibility.
```

```mdx
### Direct Upload Flow

1. **Create Deployment**: Agent calls `POST /api/deployments/direct` with each relative file path, SHA-1 digest, and byte size
2. **Upload Files**: Agent streams each file to `PUT /api/deployments/:id/files/:fileId/content`
3. **Retry If Needed**: Inspect `deployments.files` for `uploaded_at`
4. **Start Build**: Agent calls `POST /api/deployments/:id/start`
```

- [ ] **Step 4: Verify the sample config and dashboard package build**

```bash
cd /Users/lyu/Documents/GitHub/InsForge
docker compose -f docker-compose.yml config --quiet
docker compose -f docker-compose.prod.yml config --quiet
docker compose -f deploy/docker-compose/docker-compose.yml config --quiet

cd /Users/lyu/Documents/GitHub/InsForge/packages/dashboard
npm run typecheck
npm run build
```

Expected:
- all three `docker compose ... config --quiet` commands exit 0
- dashboard typecheck succeeds
- dashboard build succeeds

- [ ] **Step 5: Commit**

```bash
cd /Users/lyu/Documents/GitHub/InsForge
git add \
  packages/dashboard/src/features/deployments/services/deployments.service.ts \
  .env.example \
  docker-compose.yml \
  docker-compose.prod.yml \
  deploy/docker-compose/.env.example \
  deploy/docker-compose/docker-compose.yml \
  docs/agent-docs/deployment.md \
  docs/core-concepts/deployments/architecture.mdx
git commit -m "docs: document direct deploy flow and self-host config"
```

---

## Task 5: Run the full cross-repo verification pass

**Files:**
- Test: `backend/tests/unit/deployment-direct-flow.test.ts`
- Test: `backend/tests/unit/vercel-upload-batching.test.ts`
- Test: `../insforge-mcp/src/shared/tools/deployment.ts`
- Test: compose manifests and docs touched above

- [ ] **Step 1: Run the full backend verification suite**

```bash
cd /Users/lyu/Documents/GitHub/InsForge/backend
npm test
npm run build
```

Expected:
- `vitest run` passes
- backend `tsup` build succeeds

- [ ] **Step 2: Run shared schema and dashboard verification**

```bash
cd /Users/lyu/Documents/GitHub/InsForge/packages/shared-schemas
npm run build

cd /Users/lyu/Documents/GitHub/InsForge/packages/dashboard
npm run typecheck
npm run build
```

Expected:
- shared schemas `tsc` build succeeds
- dashboard typecheck and build both succeed

- [ ] **Step 3: Run MCP verification**

```bash
cd /Users/lyu/Documents/GitHub/insforge-mcp
npm test
npm run build
```

Expected:
- MCP tests succeed
- MCP build succeeds

- [ ] **Step 4: Perform the real smoke tests**

```text
1. Legacy backend smoke test:
   - Call POST /api/deployments
   - Upload a zip to the returned presigned URL
   - Call POST /api/deployments/:id/start
   - Confirm the flow still works unchanged

2. Direct backend smoke test:
   - Call POST /api/deployments/direct with a small manifest
   - Upload at least one file to PUT /api/deployments/:id/files/:fileId/content
   - Call POST /api/deployments/:id/start
   - Confirm deployments.runs transitions to READY

3. MCP smoke test:
   - Against a direct-capable backend, run create-deployment from a real source directory
   - Confirm direct file uploads happen with bounded concurrency
   - Against an older backend or forced 404, confirm fallback to legacy zip upload
```

- [ ] **Step 5: Final commit or tag-ready checkpoint**

```bash
cd /Users/lyu/Documents/GitHub/InsForge
git status
git log --oneline -n 5
```

Expected:
- working tree clean or only intentionally staged release changes
- recent commits show the contract, backend, MCP, and docs/config slices in order

---

## Self-Review

### Spec coverage

- Shared schemas cover manifest registration, returned `fileId`s, upload response, and start payloads.
- Backend plan covers `deployments.runs` / `deployments.files` persistence, streaming proxy, rate-limit bypass, and direct-vs-legacy branching.
- MCP plan covers backend version gating, direct-first behavior, and `404`-based fallback.
- Self-host coverage includes `.env.example`, root compose, packaged compose, and docs.
- Validation covers backend, shared schemas, dashboard, MCP, compose config parsing, and both legacy + direct smoke tests.

### Placeholder scan

- No `TODO`, `TBD`, or "implement later" placeholders remain.
- Every code-changing step includes a concrete code block.
- Every verification step includes a concrete command or explicit manual smoke-test checklist.

### Type consistency

- `CreateDirectDeploymentRequest`, `CreateDirectDeploymentResponse`, `DeploymentManifestFile`, and `StartDeploymentRequest` are used consistently between shared schemas, backend, dashboard service client, and MCP.
- Backend routes and MCP use the same endpoint names: `POST /api/deployments/direct`, `PUT /api/deployments/:id/files/:fileId/content`, and `POST /api/deployments/:id/start`.
- The plan keeps the legacy entrypoint as `POST /api/deployments`.
