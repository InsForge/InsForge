# Sites on a self-host — design

**Date:** 2026-08-13
**Status:** draft, awaiting sign-off
**Goal:** a self-hosted InsForge can host the frontend it built, without a Vercel account and without InsForge shipping a reverse proxy.

This is the Sites counterpart of the compute multi-driver work (merged: `providers/compute/{fly,cloud,docker}.provider.ts`, migration 064, `COMPUTE_PROVIDER`). Where that work is a useful precedent, this document says so rather than re-deriving it.

---

## 1. What exists today

| Fact | Evidence |
|---|---|
| One driver, no interface | `backend/src/providers/deployments/` contains only `vercel.provider.ts` (1273 lines, 24 public methods) |
| Service imports it directly | `deployment.service.ts:9` imports from `vercel.provider.js`; 18 public methods, 1509 lines |
| The table is already provider-neutral | migration `019`: `provider TEXT NOT NULL DEFAULT 'vercel'`, `provider_deployment_id TEXT UNIQUE`; comment: "Designed to be provider-agnostic (Vercel, Netlify, Cloudflare, etc.)" |
| The wire format is already neutral | `deployments.schema.ts`: `provider: z.string()`, `providerDeploymentId` — no `vercelId` leakage to fix |
| Per-deployment file manifest exists | `deployments.files` (migration `031`): `file_path`, `sha`, `size_bytes`, `uploaded_at` per run |
| Self-host is BYO-Vercel today | `vercel.provider.ts:286` `isConfigured()` → off-cloud it needs `appConfig.deployments.vercelToken` + team + project |
| Three features are cloud-only | `deployment.service.ts:107` `getConfigMetadata()` and `:1297` `updateSlug()` refuse off-cloud; `vercel.provider.ts:744` `getSlug()` returns null |
| Sites docs have no self-host story | `docs/core-concepts/sites/overview.mdx` is Vercel-only end to end |

Consequence: **no migration is needed for the seam.** Unlike compute, the persistence layer was built for this from the start.

---

## 2. Decisions inherited, not re-opened

**The operator owns the gateway.** `docs/core-concepts/compute/overview.mdx:120` — "InsForge advertises the hostname but does not terminate TLS or route traffic — run your own gateway (Caddy, Traefik, nginx) in front, as you already do for the dashboard." Every self-hosting guide says the same (`deploy-to-hetzner.md:68`, the security guide's "Reverse proxy setup (Nginx & Caddy)" section). Sites inherits this verbatim: we publish a port or advertise a hostname, and the operator's existing gateway routes it. **We do not ship nginx or Caddy in compose, and we do not terminate TLS.**

**The ingress vocabulary is already defined.** `none | port | host` with a deployment-wide default, capabilities-reported per driver (`ingressModes`, `defaultIngress`). Sites reuses the words so one gateway config covers compute services and sites together. `none` is meaningless for a site, so the Sites driver reports `['port', 'host']`.

**A driver that cannot run somewhere fails closed.** The Docker compute driver refuses when `isCloudEnvironment()` — running customer containers on shared infrastructure is a tenant escape. The Sites Docker driver refuses on the same signal, for the same reason.

**One cloud predicate, one cloud signer.** Post-#1942: `isCloudEnvironment()` answers "whose infrastructure", `TokenManager.signCloudToken(feature, code?)` signs every outbound cloud credential. Sites already uses both (`Cloud deploy credentials`, `Custom deployment slugs`). No new predicate, no new signer.

---

## 3. The seam

Extract `SitesProvider` from what a driver must actually do, not from Vercel's full surface. Vercel-platform extras become capability-gated.

```ts
// providers/deployments/deployment.provider.ts
export interface SitesProvider {
  isConfigured(): boolean;
  capabilities(): SitesCapabilities;

  // A deployment is: take an uploaded file set, produce a served artifact.
  createDeployment(input: CreateDeploymentInput): Promise<ProviderDeployment>;
  getDeployment(providerDeploymentId: string): Promise<ProviderDeployment>;
  cancelDeployment(providerDeploymentId: string): Promise<void>;

  // Optional, each behind a capability flag:
  envVars?: EnvVarStore;        // Vercel: project env store. Docker: build-time only.
  customDomains?: DomainStore;  // Vercel: platform domains. Docker: the operator's gateway.
  getSlug?(): Promise<string | null>;
}
```

```ts
export interface SitesCapabilities {
  envVars: 'runtime' | 'build-only' | 'none';
  customDomains: boolean;
  slug: boolean;
  rollback: boolean;
  buildLogs: boolean;
  frameworkDetection: boolean;
  ingressModes: IngressMode[];   // reused from compute
  defaultIngress?: IngressMode;
}
```

Reported through `/api/metadata` as a `sites` slice, exactly as compute's slice does — clients ask instead of inferring, so a dashboard cannot offer a button the active driver has no implementation for.

Selection mirrors `services/compute/services.service.ts`: a registry built once, `SITES_PROVIDER` (`vercel` | `docker`) to force a choice, `resetForConfigChange()` for settings writes, and an explicit error when a forced driver is unavailable rather than a silent fallback.

---

## 4. The Docker driver

**Mechanism.** Each deployment becomes an immutable image plus a container:

1. The uploaded file set is already on disk per run (`deployments.files` + S3/local object store).
2. Build: reuse `docker.provider.ts:677 buildFromContext()` (BuildKit) — the same code path compute's source builds use.
3. The output is served by a generated `nginx:alpine` layer over the build output directory.
4. Run it as a labelled container, ownership-scoped the way compute does, with `port` or `host` ingress.

**Why an image per deployment rather than a shared static server over a volume:** an atomic switch and a real rollback come for free. Start the new container, flip the gateway target, stop the old one — no half-written document root, and "roll back" is "start the previous image" instead of "restore files". It also reuses compute's spec-hash and image-prune machinery instead of inventing retention rules for a volume.

**Cost, stated plainly:** a build per deployment, and image storage proportional to retained deployments. Prune policy is a Phase 3 item with an explicit default (keep N most recent), and it must `log()` what it dropped — a silent prune reads as data loss.

**Framework detection is where this driver cannot match Vercel.** Vercel infers the framework from `package.json` and `vercel.json`. Proposed scope for v1: static output only. Run the declared build command (default `npm ci && npm run build`), serve the detected output directory (`dist`, `build`, `out`, in that order), and let a project override both. SSR — Next.js server rendering, streaming, middleware — is a **non-goal** for v1; a static export works, a server-rendered app does not. The capability flag says so and the dashboard says so, rather than failing at build time with a confusing error.

---

## 5. Non-goals

- Shipping or configuring nginx/Caddy. Documented as the operator's job, consistent with compute and the dashboard.
- TLS termination, certificate issuance, domain verification on self-host. `customDomains: false` for the Docker driver; the operator points a hostname at the published port.
- Matching Vercel's framework matrix, or SSR of any kind, in v1.
- Preview deployments per branch or per commit.
- Changing anything about how cloud projects deploy. Cloud stays Vercel-through-cloud-backend, byte for byte.

---

## 6. Scope of the first PR

**One PR completes the backend.** Splitting the seam out on its own would ship an interface nobody can use and a diff whose intent is invisible to review; the compute Docker work landed the same way (seam + driver + source build on one branch).

In scope — branch `feat/sites-self-host-backend`:

1. `SitesProvider` + `SitesCapabilities`, with the Vercel driver wrapped in it.
2. Provider registry and `SITES_PROVIDER`, mirroring `services/compute/services.service.ts`, including the cloud hard-guard.
3. The `sites` capability slice on `/api/metadata`.
4. The Docker driver: prebuilt directory first, then source build over `buildFromContext()`, container lifecycle, `port` / `host` ingress.
5. Rollback and image retention, with retention logging what it dropped.
6. Route-level honesty: the three cloud-only features stop being offered to a driver that cannot do them.

Out of scope, each its own PR afterwards:

- **Dashboard.** Reads the capability slice; gating and the setup guide follow the compute precedent.
- **CLI.** `insforge sites deploy` against the Docker driver.
- **Docs.** The self-host section `docs/core-concepts/sites/overview.mdx` does not have.

Consequence to accept up front: this is a large backend diff. It stays reviewable only if the driver is additive — no behaviour change on any cloud path — and every gate has a test that fails when the gate is removed.

## 7. Decisions made to unblock the PR

These were open; they are called here so the diff has a written basis. Both are reversible without touching the seam.

1. **One site per instance in v1.** Matches today's one-project-one-site behaviour, so no route or naming changes. Multiple sites would change the ingress and naming model and can be added later without disturbing the interface.
2. **`SITES_DOMAIN`, defaulting to `COMPUTE_DOMAIN` when unset.** A separate variable lets sites and services live on different domains; the fallback means an operator who already configured compute configures nothing new.
3. **Env vars on the Docker driver are `build-only`.** A runtime env store has no meaning for a static site. The capability says `build-only` rather than `none` because the values do reach the build.
4. **The CLI needs an explicit prebuilt directory.** Today it uploads the source tree and Vercel builds it. For the prebuilt path the caller names the directory; the driver does not guess.
