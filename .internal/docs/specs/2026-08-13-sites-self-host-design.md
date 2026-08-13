# Sites on a self-host — design

**Date:** 2026-08-13
**Status:** built — backend complete on `feat/sites-self-host-backend`. Corrections from implementation are marked **Corrected**.
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

As built, in `providers/deployments/sites.provider.ts`:

```ts
export interface SitesProvider {
  readonly name: SitesProviderName;
  isConfigured(): boolean;
  capabilities(): SitesCapabilities;

  // Uploads, then a deployment made from what was uploaded.
  uploadFile(fileContent: Buffer): Promise<string>;
  uploadFileStream(input: {
    content: Readable;
    sha: string;
    size: number;
    signal?: AbortSignal;
  }): Promise<string>;
  uploadFiles(files: Array<{ path: string; content: Buffer }>): Promise<UploadedFileRef[]>;
  createDeployment(input: CreateDeploymentInput): Promise<ProviderDeployment>;
  createDeploymentWithFiles(
    files: UploadedFileRef[],
    options?: Omit<CreateDeploymentInput, 'files'>
  ): Promise<ProviderDeployment>;
  getDeployment(providerDeploymentId: string): Promise<ProviderDeployment>;
  cancelDeployment(providerDeploymentId: string): Promise<void>;

  // Each present only when its capability says so:
  envVars?: EnvVarStore;   // a runtime store; a build-only driver omits it
  domains?: DomainStore;
  slug?: SlugStore;        // get + updateCache, together
  rollbackTo?(providerDeploymentId: string): Promise<ProviderDeployment>;
}
```

Two signatures in the draft above were wrong because they were written from the design rather than the code — `uploadFileStream` returns the sha and takes an abort signal, and `domains.add` returns a domain without an id. `tsc` caught both when Vercel was declared to implement the interface, which is the argument for extracting a seam from a working implementation rather than for it.

Optional features are grouped stores rather than a dozen optional methods, so a caller asks `if (!provider.domains)` instead of probing for a method. The slug pair travels together (`get` + `updateCache`) because a cache-poke that could drift from its reader is worse than either alone.

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

1. **Corrected — the bytes were not on disk.** Uploads streamed straight to Vercel; only the manifest (`path`, `sha`, `size`) was stored locally. The driver stages content addressed by sha under `SITES_STAGING_DIR`, which is the protocol the callers already speak, so a file shared by two deployments is stored once.
2. **Corrected — the classic builder, not BuildKit.** `docker.client.ts` deliberately uses `version=1`: BuildKit resolves `FROM` through a gRPC session that a plain POST does not have, so it cannot pull base images at all (`nginx:alpine: no active sessions`). The sites driver calls `dockerBuild()` directly rather than compute's `buildFromContext()`, which tags per *service* and has no meaning here.
3. The context is tarred in memory (`tar-stream`) and sent over the socket, so no host path is involved. A bind mount would be interpreted by the daemon on the host, where this container's paths do not exist.
4. Serving is a generated `nginx:alpine` stage; source builds add a `node:22-alpine` stage whose output alone is copied forward, so the toolchain never reaches the image that runs.
5. Run as a labelled container, ownership-scoped the way compute does, with `port` or `host` ingress.

**Why an image per deployment rather than a shared static server over a volume:** an atomic switch and a real rollback come for free. Start the new container, flip the gateway target, stop the old one — no half-written document root, and "roll back" is "start the previous image" instead of "restore files". It also reuses compute's spec-hash and image-prune machinery instead of inventing retention rules for a volume.

**Cost, stated plainly:** a build per deployment, and image storage proportional to retained deployments. **Built:** retention keeps three — the live deployment plus two rollback steps — and logs what it removed. It only touches containers carrying this driver's labels for this project, and only images this driver tagged, so a shared base image or another tool's container is never a candidate.

**Framework detection is where this driver cannot match Vercel.** Vercel infers the framework from `package.json` and `vercel.json`; this driver reports `frameworkDetection: false` and serves what it is given. Static output only: SSR — Next.js server rendering, streaming, middleware — is a **non-goal**.

Three things it refuses rather than guesses, all of them cases where guessing produces something that looks like success:

- **A source tree with no build command.** Served verbatim, the browser downloads `package.json` and an `index.html` pointing at `/src/main.tsx`. Detected by "has a manifest, has no index.html".
- **A newline in a build or install command.** Arbitrary shell is the point of a build command; a newline would end the `RUN` instruction and let the value append its own Dockerfile directives, which is a different privilege.
- **An `outputDirectory` that matches nothing.** Falling back to the whole tree would publish the source.

Guessing *which* conventional output directory holds the build (`dist`, `build`, `out`) is fine and happens in-image; guessing that a build produced output at all is not, so finding none fails the build with that message.

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
- **CLI.** `insforge sites deploy` against the Docker driver. Until it lands, the driver's `outputDirectory` handling is what makes the existing upload usable — the CLI ships a whole source tree today because Vercel builds it.
- **Docs.** The self-host section `docs/core-concepts/sites/overview.mdx` does not have.

**Built in this PR:** the seam, the registry and `SITES_PROVIDER`, the `sites` metadata slice, the Docker driver (prebuilt and source builds), rollback with `POST /api/deployments/:id/rollback`, retention, and build logs.

Consequence to accept up front: this is a large backend diff. It stays reviewable only if the driver is additive — no behaviour change on any cloud path — and every gate has a test that fails when the gate is removed.

## 6b. Capabilities as built

| | `vercel` | `docker` |
|---|---|---|
| `envVars` | `runtime` | `build-only` — build args, baked into the artifact and visible in image history, which is why it is not called a store |
| `customDomains` | true | false — the operator points a hostname at the published port |
| `slug` | true | false — no shared domain to name anything in |
| `rollback` | **false** | true |
| `buildLogs` | **false** | true |
| `frameworkDetection` | true | false |
| `ingressModes` | `['host']` | `['port', 'host']` |

The two `false` entries under `vercel` are findings, not omissions: this codebase has no logs method on that provider and no rollback anywhere, and the dashboard's "Deployment Logs" page is a history list. The local driver is the first to have either.

## 7. Decisions made to unblock the PR

These were open; they are called here so the diff has a written basis. Both are reversible without touching the seam.

1. **One site per instance in v1.** Matches today's one-project-one-site behaviour, so no route or naming changes. Multiple sites would change the ingress and naming model and can be added later without disturbing the interface.
2. **`SITES_DOMAIN`, defaulting to `COMPUTE_DOMAIN` when unset.** A separate variable lets sites and services live on different domains; the fallback means an operator who already configured compute configures nothing new.
3. **Env vars on the Docker driver are `build-only`.** A runtime env store has no meaning for a static site. The capability says `build-only` rather than `none` because the values do reach the build.
4. **The CLI needs an explicit prebuilt directory.** Today it uploads the source tree and Vercel builds it. For the prebuilt path the caller names the directory; the driver does not guess.
5. **`tar-stream` (MIT, 32 KB) over a hand-rolled ustar writer.** Approved after due diligence. The deciding risk was ustar's 100-byte name field: a frontend build's nested paths exceed it, so a hand-rolled writer needs correct `prefix` splitting, and getting that wrong fails only for deep paths.
6. **Capabilities are published under a `sites` key, not inside the existing `deployments` slice.** The CLI reads that slice's mere *presence* as "this backend can honour a `[deployments] subdomain` write" (`config-capabilities.ts`). Putting capabilities there would make the probe true for a driver with no slugs — the exact class of bug this work removes — and fixing the probe instead would be a cross-repo lockstep change. `deployments` keeps answering "can this take a subdomain"; `sites` answers "what can the active driver do".
7. **A new error code, `DEPLOYMENT_NOT_CONFIGURED`.** The unconfigured path reported `INTERNAL_ERROR`, so a client could not tell "you have not set this up" from "we broke".
