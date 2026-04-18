# Deploy routes accept trial_key auth — design

**Ticket:** [InsForge/insforge#1124](https://github.com/InsForge/insforge/issues/1124)

## Problem

OSS deploy routes (`POST /api/deployments*`, `PUT /api/deployments/:id/files/:fileId/content`, `POST /api/deployments/:id/start`) currently gate on `verifyAdmin` which accepts only admin JWTs and `ik_*` API keys (`backend/src/api/middlewares/auth.ts:74-119`). **Trial keys** (`ins_agent_trial_sk_*` minted by cloud-backend `POST /api/agents/v1/signup`) are never recognized, so agents that signed up the ephemeral way have a project but cannot deploy to it.

**Operator constraint (authoritative, 2026-04-18 "SCOPE REINSTATED" comment on #1124):** agents must NEVER obtain `project_api_keys`. The trial_key / user-agent-key is their sole credential throughout their lifecycle. So the "agent fetches `project_api_key` from `GET /projects/:id/access-api-key` then deploys" intermediate is forbidden. OSS deploy endpoints must accept trial / user-agent keys directly.

## DB topology finding

**The two backends run on SEPARATE Postgres instances.**

Evidence:
- `insforge/docker-compose.yml:4-26` — OSS ships its own `postgres:v15.13.2` service as part of the per-instance monorepo compose stack.
- `insforge/backend/src/infra/database/database.manager.ts:36-50` — OSS reads `POSTGRES_HOST` / `POSTGRES_PORT` / `POSTGRES_DB` / `POSTGRES_USER` / `POSTGRES_PASSWORD` from env and connects to whatever that resolves to. In the docker compose flow that is the in-compose `postgres` service.
- `insforge-cloud-backend/src/config/database.ts:7-23` — cloud backend uses the same env var names but points at the **multi-tenant** Postgres that holds `organizations`, `users`, `projects`, `trial_users`, `user_agent_keys`. That table graph does not exist in the OSS per-instance DB.
- `insforge-cloud-backend/migrations/052_trial_users.sql` + `053_user_agent_keys.sql` — these tables live in the cloud DB only. OSS has no migration for them.
- `insforge/backend/src/infra/security/token.manager.ts:25-30, 149-191` — OSS already treats cloud as a remote system (fetches `${CLOUD_API_HOST}/.well-known/jwks.json` via JWKS, uses it to verify cloud-minted JWTs in `verifyCloudBackend`). Cross-backend auth is already the established pattern.

Therefore a direct DB lookup from OSS into `trial_users` / `user_agent_keys` is not possible without coupling the two deployments. We need **cross-backend verification**.

## Chosen path: B — cross-backend verify endpoint

### Why not A (shared DB)
Rejected: the two instances are architecturally separate — OSS is per-tenant, cloud is multi-tenant. Making OSS capable of reaching the cloud DB would break OSS's self-host story and leak multi-tenant rows across instance boundaries.

### Why not "cloud mints scoped JWT, OSS verifies via JWKS"
Appealing because the JWKS path already exists (`verifyCloudBackend`), but it adds an extra round-trip to the agent's flow:
  1. Agent → cloud `POST /api/agents/v1/signup` → returns trial_key
  2. Agent → cloud `POST /api/agents/v1/mint-deploy-jwt` → returns short JWT (**new hop**)
  3. Agent → OSS `POST /api/deployments` with JWT
The operator constraint is that the trial_key is the sole credential — the agent should just `Authorization: Bearer ins_agent_trial_sk_<…>` the OSS deploy directly.

### Path B: OSS calls cloud's `POST /internal/v1/verify-agent-key`

**Sequence (happy path):**

```
agent                           OSS (/api/deployments)              cloud (/internal/v1/verify-agent-key)
 | --Bearer ins_agent_trial_sk_xyz -->                                |
 |                                  | -- POST verify-agent-key      -->|
 |                                  |    body: {key_hash, nonce, ts}    |
 |                                  |    headers: X-Service-Signature   |
 |                                  |<-- 200 {valid, trial_user_id,     |
 |                                  |          project_id, org_id,      |
 |                                  |          quota, expires_at, tier} |
 |                                  |                                   |
 |                                  | (cache verdict in memory ~60s)    |
 |                                  | req.trial = {...}                 |
 |                                  | quota check, proceed to handler   |
 |<-- 201 {id, ...}                 |                                   |
```

**Sequence (unhappy — quota exceeded):**

```
agent                           OSS
 | -- Bearer ins_agent_trial_sk_xyz (2nd deploy, storage_mb exceeded) -->
 |                               (verify succeeds, quota check fails)
 |<-- 402 {error: "claim_required", reason: "storage_exceeded",
 |          claim_url: "https://insforge.app/claim/<trial_user_id>"}
```

### Cloud contract (to be implemented in a follow-up cloud-backend ticket — filed alongside this PR)

**Endpoint:** `POST {CLOUD_API_HOST}/internal/v1/verify-agent-key`

**Auth:** `X-Service-Signature: sha256=<hmac(INTERNAL_SERVICE_SECRET, ts + '.' + nonce + '.' + body)>` with `X-Service-Timestamp` + `X-Service-Nonce` headers. Cloud rejects if `|now - ts| > 5min` or nonce seen within that window (simple LRU or Redis set).

**Body:**
```json
{
  "key": "ins_agent_trial_sk_xyz…"   // full plaintext bearer
}
```
Cloud hashes with `crypto.createHash('sha256').update(key).digest('hex')` and looks up in `trial_users.trial_key_hash` (active: `revoked_at IS NULL AND expires_at > now()`), then `user_agent_keys.key_hash` (active: `revoked_at IS NULL AND (expires_at IS NULL OR expires_at > now())`).

**Response 200:**
```json
{
  "valid": true,
  "tier": "trial" | "user_agent_key",
  "trial_user_id": "uuid",            // present if tier=trial
  "user_id": "uuid",                  // present if tier=user_agent_key
  "project_id": "uuid",
  "organization_id": "uuid",
  "quota": { "storage_mb": 100, "bandwidth_gb_day": 1, "compute_deploy_mb": 128, "api_calls_day": 1000, "compute_hours_day": 2, "projects": 1 },
  "expires_at": "2026-04-25T00:00:00Z" // ISO; present if tier=trial
}
```

**Response 401:** `{"valid": false, "reason": "not_found" | "expired" | "revoked"}`

### OSS side — this PR

1. **`backend/src/services/auth/trial-key-verifier.ts` (new)** — HTTP client that hits cloud's verify endpoint, signs request with HMAC, parses response, caches successful verdicts in-memory with a 60s TTL keyed by key-hash (so repeat calls within a single deploy flow don't hammer cloud). Takes `CLOUD_API_HOST` and `INTERNAL_SERVICE_SECRET` from env. Fails closed on HTTP/network errors — returns null, middleware converts to 401.

2. **`backend/src/api/middlewares/auth.ts`** — add:
   - `isTrialKey(token)` / `isUserAgentKey(token)` prefix checks (mirror cloud-backend's `src/services/trial-signup/trial-keys.ts:61-71`).
   - `verifyAdminOrTrialAgent(req, res, next)` — new middleware. Extracts bearer; if `ins_agent_trial_sk_*` or `ins_agent_sk_*`, calls the verifier and sets `req.trial = {trial_key, trial_user_id, user_id, project_id, organization_id, quota, tier, expires_at}`. Else falls through to existing `verifyAdmin` (admin JWT / ik_*-key path, unchanged). **Zero behavior change for non-trial bearers.**

3. **`backend/src/api/middlewares/trial-quota.ts` (new)** — `checkTrialDeployQuota(req, res, next)`:
   - If `req.trial` is not set, no-op (admin path unchanged).
   - For `POST /api/deployments` and `POST /api/deployments/direct`: no upload size known yet, so just verify `req.trial.quota.compute_deploy_mb > 0` and `expires_at > now()`. Otherwise 402 `{error: "claim_required", reason: "trial_expired" | "quota_exhausted", claim_url}`.
   - For `PUT /api/deployments/:id/files/:fileId/content`: check `Content-Length` header against `quota.storage_mb * 1024 * 1024`. Reject 402 if oversized.
   - For `POST /api/deployments/:id/start`: verify still within expiry + quota.
   - Note: bandwidth tracking is COMPUTE-side (Vercel/Deno); enforcement on completion is a cross-service concern outside this PR's scope — quota field is still surfaced on `req.trial` for downstream consumers and the enforcement ticket.

4. **`backend/src/api/routes/deployments/index.routes.ts`** — swap `verifyAdmin` for `verifyAdminOrTrialAgent` on the 4 endpoints in the ticket; chain `checkTrialDeployQuota` after. The other 7 endpoints (list/get/metadata/slug/domains/sync/cancel) keep `verifyAdmin` — agents don't manage those.

5. **`claim_url` shape** — `${CLOUD_API_HOST}/claim/<trial_user_id>` (mirrors what cloud's signup response already returns in `SignupResult.claimUrl`). For `user_agent_key` tier, `claim_url` is null (already claimed).

## Config (env)

Additions to OSS runtime:
- `CLOUD_API_HOST` — already exists (`backend/src/infra/config/app.config.ts:35`). Reused as the verify base URL.
- `INTERNAL_SERVICE_SECRET` — **new**. Shared secret for HMAC signing of `POST /internal/v1/verify-agent-key`. Must be set identically on both OSS (to sign) and cloud (to verify). Absence fails closed: no trial-key path works, admin/`ik_` paths unaffected.

## Test plan

**Unit (Vitest, `backend/tests/unit/`):**
- `trial-key-verifier.test.ts` — valid key → returns parsed context; invalid/network-error → returns null; cache hits skip HTTP; HMAC header shape is correct.
- `auth-trial-agent.test.ts` — `verifyAdminOrTrialAgent`:
  - Bearer `ins_agent_trial_sk_abc` + verifier returns valid → sets `req.trial`, calls next().
  - Bearer `ins_agent_trial_sk_abc` + verifier returns null → 401.
  - Bearer admin JWT → falls through to `verifyAdmin`, unchanged.
  - Bearer `ik_*` → falls through to `verifyApiKey`, unchanged.
  - No bearer → 401 (matches existing `verifyAdmin` behavior).
- `trial-quota.test.ts` — `checkTrialDeployQuota`:
  - No `req.trial` → no-op.
  - Expired trial → 402 with `reason: "trial_expired"`.
  - `Content-Length` > `quota.storage_mb * MB` → 402 with `reason: "storage_exceeded"`.
  - Under quota → next().

**Regression (unit):**
- Existing `verifyAdmin` tests still pass — no change to the admin JWT / `ik_` paths.

**E2E (manual — tracked as follow-up):** full trial-signup → deploy HTML → READY → URL resolves round-trip requires the cloud-backend verify endpoint to exist. Filed as follow-up ticket.

## Risks / rollback

- **Cloud-backend verify endpoint doesn't exist at merge time.** Rollback is trivial: revert the 4 `verifyAdminOrTrialAgent` swaps. Admin / `ik_*` paths untouched. Trial-tier agents fail their deploy with a clean 401, matching today's behavior.
- **`INTERNAL_SERVICE_SECRET` misconfigured.** Verifier fails closed (401). Admin path unaffected. Log a clear one-time warning at startup if `process.env.INTERNAL_SERVICE_SECRET` is empty AND `process.env.CLOUD_API_HOST` is set.
- **Replay attacks on verify endpoint.** Mitigated by ts + nonce inside the signed envelope; cloud rejects expired / reused nonces.
- **Cache staleness on key revoke.** 60s TTL is a deliberate trade: a revoked key keeps authenticating for up to 60s. The alternative (zero cache) costs a cloud RTT on every byte of deployment upload — a deploy is many requests. 60s matches how we already cache JWKS (`cacheMaxAge: 600000` — 10min; we chose much shorter because keys can be revoked out-of-band, unlike signing keys).

## Out of scope (explicit)

- Adding the cloud `POST /internal/v1/verify-agent-key` endpoint itself (follow-up cloud-backend ticket).
- Bandwidth metering on completion — quota field surfaced, enforcement lives in the compute layer (Vercel webhook / Deno subhosting ticket).
- `user_agent_key` (post-upgrade long-lived key) handling — same prefix check, same cloud endpoint, mostly free; in this PR to avoid re-touching the middleware later.
- Dashboard/admin UI changes for trial projects.

## References

- `backend/src/api/middlewares/auth.ts:74-119` — existing `verifyAdmin`
- `backend/src/api/routes/deployments/index.routes.ts:31-179` — the 4 target routes
- `backend/src/infra/security/token.manager.ts:25-30, 149-191` — established cloud-verification pattern (JWKS)
- `backend/src/infra/config/app.config.ts:32-41` — existing `cloud.apiHost` config
- `insforge-cloud-backend/src/services/trial-signup/trial-keys.ts:16-71` — key prefix + hash functions (mirrored here)
- `insforge-cloud-backend/src/services/trial-signup/quota.config.ts:21-37` — `TrialQuota` shape
- `insforge-cloud-backend/src/middleware/auth.ts:56-132` — cloud-side trial auth middleware (pattern reference)
- `insforge-cloud-backend/migrations/052_trial_users.sql` — trial_users schema
- `insforge-cloud-backend/migrations/053_user_agent_keys.sql` — user_agent_keys schema
