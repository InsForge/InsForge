# Self-Host Container Deploy — Design

**Date:** 2026-08-05
**Revised:** 2026-08-06 — scoped down to the agreed v1 plan.
**Aligned:** 2026-08-07 — Phases 0–2 implemented; this document now describes what
shipped. Phase 3 (Sites) is still design only and is marked as such.

> **Implementation:** PR #1892, branch `feat/self-host-docker-compute`.
>
> Where this document originally guessed and the implementation then measured, the
> measured answer is recorded inline with what it replaced — the wrong guesses are
> more useful kept than deleted, because several of them are the sort a reader would
> otherwise make again.

**Essence:** container CRUD and lifecycle management via the host's Docker Engine API, behind the
Compute API that already exists.

Self-hosted InsForge runs its data locally but still leans on Fly.io for compute and Vercel for
Sites. This adds a local Docker driver behind the existing Compute API so an operator can manage
custom containers and host sites on their own host with neither account.

## Goals

- Reuse the existing container CRUD, logs, and events API. **This work adds a driver; it does not
  design a new API surface.**
- Support both image deploys and source builds. (Self-host on Fly supports image only today — the
  source path is broken; see Verified foundation.)
- Model container-backed Sites as Compute with routing attached.

## Non-goals

- Auto-scaling and scale-to-zero.
- Deployment versions, preview URLs, and rollback **as user-facing features** (the data model
  still carries the indirection — see Sites).
- Configuring the operator's own external gateway.
- GitHub auto-deploy.
- Framework auto-detection and zero-config builds.
- Multi-host scheduling and Kubernetes.
- **Persistent volumes.** Decided 2026-08-07: this is a platform-wide gap, not a
  self-host one — the Fly path has no volumes either, so adding them to Docker alone
  would make the drivers asymmetric and force a per-provider caveat into the docs and
  CLI. State survives restarts and host reboots (the same container comes back) but
  **not a redeploy**: changing image, env, or port recreates the container and discards
  anything written inside it. Use the project's Postgres or Storage for data that must
  persist. Doing volumes properly means both drivers plus a `volumes` capability.

## Risk

An attacker could try to obtain host control by creating a higher-privilege container. This is the
one safety concern specific to self-hosting this feature; the control for it is in Threat model
below.

## Problem

- **Compute.** [`selectComputeProvider()`](../../../backend/src/services/compute/services.service.ts)
  resolves to Fly if `FLY_API_TOKEN` + `FLY_ORG` are set, else the cloud proxy if `PROJECT_ID` +
  `CLOUD_API_HOST` + `JWT_SECRET` are set, else throws `503 COMPUTE_NOT_CONFIGURED`. There is no
  third option, so a self-hoster's only path to a custom container runs on Fly's infrastructure
  while their Postgres and storage sit on their own box.
- **Sites.** [`vercel.provider.ts`](../../../backend/src/providers/deployments/vercel.provider.ts)
  is the only provider; self-host requires `VERCEL_TOKEN` + `VERCEL_TEAM_ID` + `VERCEL_PROJECT_ID`.
  There is no way to serve a site from the self-hosted host at all.

Every other capability already has a local driver — storage
([`local.provider.ts`](../../../backend/src/providers/storage/local.provider.ts) vs S3), logs,
analytics, and webscraper all follow the same `local` / `cloud` split chosen by env in the service
layer. Compute and deployments are the two outliers.

## Verified foundation

Read 2026-08-05 against `main` @ `d7969bfe9`.

**The stack has no reverse proxy.** [`docker-compose.yml`](../../../docker-compose.yml) and
[`docker-compose.prod.yml`](../../../docker-compose.prod.yml) run `postgres`, `postgrest`,
`insforge` (7130/7131/7132), and `deno` (7133) on one bridge network. TLS and routing are the
operator's today ([deployment-security-guide.md](../../../docs/deployment/deployment-security-guide.md)
tells them to bring nginx or Caddy).

**No compose file mounted the Docker socket.** Verified across all six root compose files,
[deploy/docker-compose/](../../../deploy/docker-compose/), and
[deploy/zeabur/template.yml](../../../deploy/zeabur/template.yml) — zero occurrences. Adding the
mount to each variant was a Phase 1 deliverable.

*Shipped:* five variants carry the compute env block plus a commented socket mount and `group_add` —
the two root files, `deploy/docker-compose/`, and the `deploy/coolify/` + `deploy/dokploy/` files
that landed on main mid-implementation. Zeabur is untouched: it gives you a container, not a host,
so there is no socket to mount (see the platform tiers).

Validating this needs care that the first attempt lacked. Checking that the text is present and that
the file parses both pass while the mount sits on the **wrong service** — a rebase auto-merge put one
hunk inside `deno:`, and a `grep -c` for `docker.sock` counted it as success because YAML tolerates
comments anywhere. The check that catches it is `docker compose config --format json` with the
instructions uncommented, asserting the mount resolves onto `insforge`, `group_add` resolves to the
supplied GID, and **no other service** carries a socket mount.

**The abstraction boundary is in the wrong place.** Fly-specific logic lives in the *service*, not
the provider — `makeFlyAppName()`, `makeNetwork()` (Fly 6PN, keyed on `APP_KEY`),
`makeEndpointUrl()` (defaults to `*.fly.dev`), plus the in-place region-change rejection, which is
a Fly machine constraint rather than a universal one.

**The wire contract leaks the provider.** `fly_app_id` / `fly_machine_id` columns
([038](../../../backend/src/infra/database/migrations/038_create-compute-services.sql)),
`flyAppId` / `flyMachineId` on
[`serviceSchema`](../../../packages/shared-schemas/src/compute-services.schema.ts), `cpuTierEnum`
hardcoded to Fly's `shared-1x` / `performance-8x`, `region` defaulting to `iad`. ~45 references
across backend, dashboard, and shared schemas, plus the CLI, which gates its log and event panels
on `flyMachineId` being truthy.

**`makeNetwork()` is cross-project isolation, not database isolation.** On Fly it keeps one
customer's services from seeing another's inside InsForge's shared org. The backend and Postgres
are not on that network at all — they are on a different host entirely. So "the container cannot
reach Postgres internally" is a physical fact on Fly, not a decision to replicate.

**Source-mode deploy works only on Cloud.** The CLI's `compute deploy <dir>` shells out to
`flyctl deploy --remote-only --build-only`; image mode (`--image`) is already provider-neutral.

The deploy-token endpoint exists to solve a Cloud-only problem: customer containers run in
*InsForge's* Fly org, `flyctl` runs on the customer's machine, and handing out the org-wide token
would let any customer manage every other customer's app — so the cloud mints a ~20-minute
macaroon attenuated to one app. A self-hoster uses their own account and their own org, so there
is nothing to narrow, and `issueDeployTokenForService()` correctly refuses with `400` unless the
provider is `CloudComputeProvider`.

The bug is that **the CLI calls that endpoint unconditionally** — one code path, written for cloud,
with no branch for self-host. The self-host path the error message describes was never written:

| Step | Action | Result |
| --- | --- | --- |
| 2 | `GET /api/compute/services` | not found |
| 3 | `POST /api/compute/services/deploy` | **succeeds** — writes the row (`deploying`), creates the real Fly app, allocates IPs |
| 4 | `POST /api/compute/services/:id/deploy-token` | **400** — provider is `FlyProvider` |
| 5 | `ossFetch` throws `CLIError` | aborts |

Step 3's side effects persist, and the CLI's rollback wraps only `flyctlBuildAndPush`, which sits
below the token call — so it never fires. Retrying re-finds the service (`flyAppId` is set) and
re-hits the 400, so nothing accumulates but the service is permanently wedged until
`compute delete`.

Capability today:

| | image mode | source mode |
| --- | --- | --- |
| Cloud | yes | yes |
| Self-host + Fly | yes | **no** — 400 at deploy-token, leaves a wedged row + empty Fly app |
| Self-host + Docker (this design) | Phase 1 | Phase 2 |

So Phase 1 shipping image-mode only is **not** a regression against the self-host status quo, and
Phase 2 is the first working self-host source-build path. Fixing the Fly path is small and
independent: skip the token request when the backend is not cloud-managed and let flyctl use the
operator's own credentials, and widen the rollback to everything after `prepareForDeploy`. The
capability signal belongs on Phase 0's descriptor rather than a new probe.

**The API surface we need already exists.**
[`services.routes.ts`](../../../backend/src/api/routes/compute/services.routes.ts) is container
CRUD: `GET /`, `GET /:id`, `POST /`, `PATCH /:id`, `DELETE /:id`, `POST /:id/start`,
`POST /:id/stop`, `GET /:id/logs`, `GET /:id/events`.

## Threat model

The operator and the developer deploying containers are the **same trust domain** — whoever runs
the box can already SSH into it. So these are explicitly not design drivers: protecting Postgres or
`JWT_SECRET` from a compromised backend (the backend legitimately holds them), and isolating a
user's own container from the host it chose to run on.

**That premise holds only when self-hosted, so the driver is now hard-disabled elsewhere.** On a
cloud-managed project the operator is InsForge and the developer is a customer: a customer creating
containers on shared infrastructure is a tenant escape, and even an unprivileged container consumes
shared capacity and can reach the internal network. Cloud does not mount the socket today, so this
was already unreachable in practice — but "unreachable because nobody mounted it" is one deployment
accident from being wrong, and the failure would be silent.

`DockerProvider.isConfigured()` therefore returns false whenever either cloud signal is present
(`isCloudEnvironment()`, or a configured cloud project), regardless of whether a socket exists. The
guard lives on `isConfigured()` rather than in the registry so any future caller inherits it; the
registry adds only an explicit branch so `COMPUTE_PROVIDER=docker` on cloud fails with "self-host
only" instead of a misleading "no socket", which would send an operator chasing a mount that is not
the problem.

The load-bearing requirement is the stated risk: **if the InsForge API key leaks, an attacker must
not be able to obtain host control by creating a container.**

This matters because a container's boundary is defined by its creation parameters, not by a ceiling
the runtime imposes. All of the following are documented, first-class Docker behaviour, not
exploits:

```
-v /:/host                       write /host/root/.ssh/authorized_keys or /host/etc/crontab → host root
--privileged                     all caps + all devices; mount /dev/sda1 and read/write the host disk
--pid=host --cap-add=SYS_PTRACE  inject into host processes
--device=/dev/sda                raw disk access
-v /var/run/docker.sock:...      the new container can itself create privileged containers
```

Note that `no-new-privileges: true` on the `insforge` compose service does not help: it constrains
the backend process, while the new container is created by the daemon.

### Control: privilege comes from operator config, never from the request body

The API key is a bearer credential that travels — CI config, `.env` files, MCP/agent contexts — and
it is the thing that leaks. Editing the compose file requires host filesystem access, which does
not. So "the developer intentionally wants a privileged container" is a legitimate request that
must be expressed at the operator layer:

```
COMPUTE_ALLOW_PRIVILEGED=false          # default
COMPUTE_ALLOWED_HOST_PATHS=             # default empty; only listed prefixes may be bind-mounted
COMPUTE_ALLOW_HOST_NETWORK=false        # default
```

The API may still let a developer declare `privileged` or a host path per service, but only inside
what the operator opened; beyond that returns `400`. Default persistence is a **named Docker
volume** — most workloads never need a host path. Grants are recorded on the existing
`CREATE_COMPUTE_SERVICE` audit entry via
[`AuditService`](../../../backend/src/services/logs/audit.service.ts).

The same gate covers builds: BuildKit's `--security=insecure` is operator-gated identically.
Ordinary `RUN` steps execute unprivileged inside a build container and are not an escalation.

### Transport: direct socket

`DockerProvider` talks to `/var/run/docker.sock` mounted into the `insforge` container.

Two scenarios were separated. Under **API key leak** (in scope) the attacker has the API, not code
execution — our validation runs normally, so a direct socket and a sidecar agent are equally safe.
Under **backend RCE** (out of scope, per the threat model) a mounted socket makes validation moot.
Since only the first is in scope, the socket wins on engineering cost: no extra deployable, no
version skew, and the full Docker API stays available — which serves the "intentionally more
privilege" case, where an agent would need a new verb per option.

Not a dead end: the `ComputeProvider` interface **is** the seam, so repointing the driver at a
remote agent later changes no service-layer code.

Rejected: a filtering socket proxy (`tecnativa/docker-socket-proxy`) filters path+method only, so
granting `POST /containers/create` passes `Privileged` / `Binds` through untouched and it cannot
scope by container id either — a surface reducer, not a privilege reducer, at the same operational
cost as an agent. A dedicated rootless/DinD daemon and a declarative compose-file handoff both
solve problems this threat model scopes out, at the cost of host-level operator setup.

## Architecture

`ComputeProvider` implemented by `FlyProvider`, `CloudComputeProvider`, and `DockerProvider`,
mirroring the `local` / `cloud` pattern the other services already use.

Naming settled against the existing conventions rather than taste. Vendor-specific providers are
not domain-qualified in this codebase (`StripeProvider`, `RazorpayProvider`, `VercelProvider`,
`OpenRouterProvider`), while cross-domain prefixes must be (`CloudAnalyticsProvider`,
`CloudComputeProvider`, `LocalStorageProvider`) or they collide — so `FlyProvider` was already
correct and the first draft's `DockerComputeProvider` was the outlier. The wire vocabulary is
`provider` throughout (`service.provider`, `computeProviderEnum`, `COMPUTE_PROVIDER`); "driver"
survives only as a local variable name where an implementation object sits next to a provider-name
string and the distinction carries information.

### Docker driver

| Operation | Docker behaviour |
| --- | --- |
| create / start | `POST /containers/create` then `/start` |
| update | CPU/memory in place via `POST /containers/{id}/update`; image, env, or port change → recreate |
| stop / delete | native lifecycle endpoints; `DELETE /containers/{id}?force=true` |
| status | `GET /containers/{id}/json` → `State.Status`, mapped onto the existing enum |
| logs | `GET /containers/{id}/logs?stdout=1&stderr=1&timestamps=1&since=` |
| events | `GET /events?filters=container,since,until` |
| waitForState | poll inspect (mirrors the existing Fly loop) |

Docker `created|running|paused|restarting|removing|exited|dead` maps onto the existing
`creating|running|stopped|failed|destroying` enum, so
[`serviceStatusEnum`](../../../packages/shared-schemas/src/compute-services.schema.ts) is unchanged.

Every managed container carries `insforge.managed=true` and `insforge.project=<id>`, and **all
reads and writes filter on those labels** so a stop or delete can never touch Postgres, another
InsForge stack, or an unrelated container. Container **names** must also be namespaced by
`APP_KEY` — the documented one-host-many-projects setup means two projects can both create a
service called `api` on the same daemon.

All containers run `restart: unless-stopped`, plus a boot-time reconcile that compares rows to
reality. The existing [`MachineGoneError`
path](../../../backend/src/services/compute/services.service.ts) generalizes without change.

Verified across a real host reboot: a container with `--restart unless-stopped` was running again
within seconds, one without a policy stayed `Exited`. **Do not infer failure from the exit code.**
Containers that shut down cleanly showed `Exited (0)` while ones the host killed showed
`Exited (137)` (SIGKILL) — so mapping 137 to `failed` would mark a chunk of services failed after
every reboot. Reconcile should treat post-boot exits as "needs starting", not "crashed".

**Socket access requires a group, and the GID is host-specific.** On Linux the socket is
`mode=660 owner=root group=docker`. A container process at uid 1000 with the socket mounted got
`permission denied while trying to connect to the docker API`; adding `--group-add <docker gid>`
fixed it. That GID was **993** on AL2023 and is commonly 999 or 998 on Debian/Ubuntu, so it cannot
be baked into the image or the compose file — the operator supplies it (`getent group docker | cut -d: -f3`).

**Correction from the end-to-end run: this instruction is Linux-only.** Docker Desktop exposes the
socket as `660 root:**root**` — there is no docker group, so the only group that grants access is 0.
The prod image runs `USER node` (uid 1000), so a Desktop operator following the Linux instruction
gets `connect EACCES /var/run/docker.sock`. Linux is the documented target and the instruction is
right for it, but the Desktop difference needs saying, and Desktop is tier-2 in the support matrix
anyway.

That EACCES was surfaced by the startup preflight with an actionable message rather than a 500 on
first deploy — which is the whole reason preflight runs at boot.

Capabilities as shipped: `scaleToZero: false` (no native Docker equivalent), `regions: false`
(`region` normalizes to `local`; the CLI still defaults `--region iad`, which the service coerces),
`ingressModes: ['none','port','host']`, `sourceBuild: 'context-upload'`, `deployTokenIssuance: false`.

Two fields from the first draft were **removed before merge**: `privileged` had zero readers, and
`regionChangeInPlace` was `false` on every provider, which meant it had moved a hardcoded Fly rule
into a field without decoupling anything. The region guard now keys off `regions` — a provider with
no regions has already had the field normalized, so the comparison never fires for it. There is
deliberately no `privileged` capability at all: the driver never emits a privileged HostConfig, so
there is nothing to declare.

CPU: `shared-Nx` → `NanoCpus = N × 1e9` with `CpuShares` lowered; `performance-Nx` → same
`NanoCpus` at default shares. Memory: `memoryMb × 1024²` bytes.

### Gotchas

All four measured against Docker Engine 29.3.1 (linux/arm64) on 2026-08-06 via `curl --unix-socket`,
not inferred.

1. **The log stream is multiplexed.** Without a TTY, `GET /containers/{id}/logs` returns an 8-byte
   header per frame — byte 0 is the stream type (`0x01` stdout), bytes 4–7 a big-endian length:

   ```
   0100 0000 0000 0026  32303236 2d30382d ...      # 0x26 = 38 = len("<30-char ts> line-1\n")
   ```

   Undemuxed, every line arrives as `^A^@^@^@^@^@^@&2026-08-06T22:51:32.781160549Z line-1`.

2. **`since` takes integer Unix seconds and is inclusive — the cursor must be two-part.**
   RFC3339Nano is **rejected**: `since=2026-08-06T22:51:34.794600842Z` returns
   `{"message":"strconv.ParseInt: parsing \"2026-08-06T22:51:34\": invalid syntax"}`. (The
   `docker logs --since` *CLI flag* accepts RFC3339 and converts locally; the API does not.)
   Inclusivity confirmed: with a line at `…:34.794`, `since=<that second>` returns it, `since=<+1>`
   does not.

   So second granularity **cannot** be the dedup key — 50 lines in one second would be re-fetched
   every poll, and dropping by second would discard the genuinely new ones. Correct algorithm:
   retain the last emitted line's full nanosecond timestamp as a watermark, request
   `since = floor(watermark)` in seconds, then drop returned lines whose nanosecond timestamp is
   `<= watermark`. `ComputeLogsResult.nextToken` carries the watermark as a **string** — same
   precision reason Fly's nanosecond integer needs raw-text extraction.

   **`tail` cannot be combined with `since`.** Found in review, not in testing. `tail=N` keeps the
   *newest* N lines, so `since=<cursor>&tail=100` over a 500-line backlog returns the newest 100 and
   the cursor then advances past the other 400 — which no later request can reach, because the cursor
   only moves forward. `tail` is therefore sent **only on the first page**, where there is no cursor to
   stay consistent with and "the most recent `limit` lines" is what the caller wants. When resuming,
   the request carries `since` alone and the driver returns the **oldest** `limit` lines, so the next
   page picks up exactly where this one stopped. The cursor is derived from the lines actually
   returned, never from one that was trimmed.

   The cost is an unbounded response body when a client resumes after a long silence against a chatty
   container. That is the right trade: the alternative silently loses log lines, and a polling client
   only ever fetches what accumulated since its last poll.

3. **`POST /containers/create` does not pull the image.** `docker run` looks as if it does, because
   the CLI catches the 404 and pulls first; the API leaves that to the caller. On a host that has
   never seen the image — every fresh self-hosted box on its first deploy — create fails with
   `No such image: <ref>`. `/images/create` must run first, and it reports failure inside the body
   with HTTP 200, exactly like `/build`.

4. **A failed build returns HTTP 200.** Confirmed with `RUN exit 7`: status 200, and the failure
   arrives at the tail of the stream as plain JSON, outside `aux`:

   ```json
   {"error":"process \"/bin/sh -c exit 7\" did not complete successfully: exit code: 7",
    "errorDetail":{"message":"…"}}
   ```

   Useful consequence: failure detection needs no protobuf decoding and is identical on both
   builders. A naive implementation sees 200 and starts a container from a tag never produced.

5. **macOS `tar` can break the build context — but not reliably, and the first write-up overstated
   it.** Files on macOS carry a `com.apple.provenance` extended attribute, and when bsdtar embeds it
   the Linux daemon rejects the whole context with
   `lsetxattr /Dockerfile: xattr "com.apple.provenance": operation not supported`.

   Observed once against Engine 29.3.1 and **not reproducible on demand**: a later attempt with an
   equivalent `tar -cf … -C dir .` produced an archive with no `SCHILY.xattr` entries and built fine,
   under both builders, even though the source files did carry the attribute. So this is a real
   failure with an environment-dependent trigger, not something every Mac hits — the original claim
   ("a day-one bug report from every Mac user") was wrong.

   Tarring with `--no-xattrs` (or `COPYFILE_DISABLE=1`) costs nothing and removes the possibility, so
   the CLI should still do it. `buildFromContext` additionally recognises the error and appends the
   fix, since on its own the message gives a developer nothing to act on.

## Network and routing

*This was the least settled area of the design. It is now implemented and measured; the provisional
warning that used to head this section is gone.*

### Ingress is per-service, default none

Most compute has no inbound traffic at all — queue workers, background processors, inference loops,
scrapers, which are exactly the cases the [compute
overview](../../../docs/core-concepts/compute/overview.mdx) leads with. Publishing a host port for
every container is the wrong default.

| ingress | Publishes host port | Reachable from | Naming / TLS |
| --- | --- | --- | --- |
| `none` (default) | no | project network only | — |
| `port` | yes | **depends on bind address** | IP:port, plain HTTP |
| `host` | yes | public | domain + HTTPS via the operator's gateway |

`port` mode is **already public** if bound to `0.0.0.0` on a reachable host — it is not "less
public", it is "public without a domain or TLS". The bind address is the knob, and the repo has
precedent both ways: [docker-compose.prod.yml](../../../docker-compose.prod.yml) binds
`127.0.0.1:${POSTGRES_PORT}:5432` for Postgres but all interfaces for the app. The CLI already
warns this way for TCP services ("reachable from the public internet. Configure auth on your
container") and the same warning applies here.

Host port is left empty on create so Docker assigns an ephemeral one (no allocation race), then
read back from `NetworkSettings.Ports`. `endpointUrl` is
[already `z.string().nullable()`](../../../packages/shared-schemas/src/compute-services.schema.ts),
so "no URL" needs no schema change. With `COMPUTE_PUBLIC_HOST` unset, `null` is returned rather than
guessing the host's public IP.

**Per-service, not deployment-wide.** The first draft made ingress a single operator setting; that
forces a worker and an API on the same deployment into the same shape, and the safe global default
leaves the API unreachable. It is a column (migration 064) with an `ingressModes` capability, because
not every provider can offer every mode — Fly allocates public IPs and a `.fly.dev` hostname at app
create, so it can only offer `host`, and asking it for `none` is not something it can honour. A mode
the provider cannot deliver is coerced to its default and logged, not rejected: failing an otherwise
valid deploy over it would be worse, but recording a mode that is not being delivered would be worse
still. `COMPUTE_DEFAULT_INGRESS` survives as the fallback for services that do not choose.

Two implementation notes that only surfaced by running it:

- **`launchMachine` and `updateMachine` return the endpoint URL**, because under `port` ingress the
  address does not exist until the container does. The first draft had the service derive the URL
  from the app name, which yields `null` for an ephemeral port — the port was published and nothing
  advertised it. A recreate also gets a *new* port, so the URL travels with the new instance id;
  measured `64385 → 64388` across an image change.
- **Docker's own default publishes on `0.0.0.0` and `[::]`** — measured, both. `COMPUTE_BIND_ADDRESS`
  defaults to loopback so reaching a container from the internet is a deliberate act.

### Containers join the project's own `insforge-network` by default

The product promise is proximity — the compute overview says containers "attach to your project's
database, storage, and auth with the same credentials a function would use". Forcing traffic out to
the public URL contradicts that and costs a TLS handshake plus a round trip out and back.

**Correction from measurement (2026-08-06, EC2 t4g.small).** An earlier draft justified this with
"NAT hairpin usually fails on Docker bridge networks". That is **wrong on AWS EC2** — measured, it
works. Two separate mechanisms were confused:

- AWS runs **split-horizon DNS** for its own hostnames: inside the VPC,
  `ec2-3-93-199-94.compute-1.amazonaws.com` resolves to the private IP (`getent hosts` → `172.31.16.241`),
  so that path never leaves the VPC and hairpin never happens.
- Hitting the **raw public IP** from inside does exercise the real hairpin path, and it returned
  `200` from both the host and inside a container — once the security group allowed the port.

So the surviving argument against the public path is not that it cannot work, it is that **it
depends on the operator's firewall**, and the failure is silent: with the security group closed,
the host, a container, and an external client all got `%{http_code}=000` / curl exit 28 — an
indefinite hang with no diagnostic. A container calling its own project's public URL through a
misconfigured security group hangs rather than erroring.

Hairpin remains platform-dependent — some home NAT routers and VPS providers genuinely do not do
it — but "AWS EC2 cannot hairpin" should not be repeated.

Compose already namespaces networks per project (`project1_insforge-network`), so cross-project
isolation is free and no dedicated compute network is needed. Service-to-service discovery works by
container DNS name on the same network. Inside a container, `postgres:5432` and `postgrest:3000`
resolve exactly as they do for the `deno` service today.

`COMPUTE_ISOLATE_NETWORK=true` opts out. Default off.

Separately owed hardening: on this network any container can reach Postgres, and the compose
default credentials are `postgres` / `postgres`. Acceptable under the threat model (same
principal), but the install flow should stop shipping default database credentials.

### The operator owns the gateway

We publish ports and routing state; we never bind :443. This is consistent with the existing
posture — nothing in the compose stack terminates TLS today. Certificate issuance, renewal, DNS
provider APIs, and wildcard certs are an unbounded support surface, and self-hosters usually
already run a gateway.

The one thing that cannot be pushed out: **the routing table is dynamic and only we know it.** If
the gateway is entirely the operator's, they would hand-edit config on every `compute deploy`,
which defeats an API-driven CRUD. So:

| Operator has | How it connects | Our work |
| --- | --- | --- |
| Traefik | its Docker provider watches container labels; new services appear automatically | emit labels |
| Caddy | `caddy-docker-proxy` plugin, same mechanism | emit labels |
| nginx | poll `GET /api/compute/routes` to generate config + reload | one read-only endpoint |
| nothing | `docker compose --profile gateway up` starts our default Caddy | one profile + generated config |

Traefik, Caddy, and nginx are pick-one-per-host (they all want :443), and the operator has usually
already chosen — something fronts the dashboard on 443 before InsForge compute exists.

The bundled Caddy profile is a **convenience default, not us taking ownership**: still a compose
service the operator can replace, off unless the profile is named.

A gateway must **not** be deployed as a compute service. It would need the Docker socket mounted
into a user container (the exact escalation the threat model forbids), privileged port binding, and
it creates a circular dependency — `compute delete` on it would take down all ingress including the
dashboard needed to fix it. Gateways are peer infrastructure. (Deploying nginx as a plain static
file server for one's own app is fine; the problem is only the thing fronting everything.)

### Platform support is not universal

The dividing line is one question: **does the operator control the Docker daemon?**

| Tier | Platforms | Status |
| --- | --- | --- |
| 1 | bare VPS, EC2, GCE, Azure VM via compose | supported |
| 2 | Dokploy, Coolify, Containarium, Docker Desktop | works with friction |
| 3 | Zeabur, Railway, Render, Kubernetes | **not supported** — fall back to Fly driver or cloud |

Tier 3 is structurally impossible, not merely unimplemented: you get a container, not a host, so
there is no socket to mount. Zeabur is an existing deployment target, so this belongs in the docs
rather than being discovered at runtime. Kubernetes needs a real provider (containerd, and mounting
the node socket is blocked by Pod Security standards).

The two decisions above shrink this problem considerably: ingress defaulting to `none` means most
compute is unaffected by platform routing differences at all, and the operator's gateway is already
platform-correct, so we never have to be.

Edge cases that **fail silently** (highest priority):

1. **SELinux hosts** (RHEL/Rocky/Fedora) — socket mount without `:z`/`:Z` gives EACCES.
2. **Cloud security groups** — EC2/GCP block arbitrary high ports by default, so a `port`-mode URL
   simply times out. Return the URL *plus* the "open this port in your security group" guidance.
3. **Dokploy / Coolify** — the worst case, because the socket may mount and it *looks* fine, then
   their reconciler cleans up containers it does not recognize and their Traefik expects specific
   entrypoint and `traefik.docker.network` values. Looks-supported is worse than unsupported.

Edge cases that fail loudly: Windows uses a named pipe (`//./pipe/docker_engine`), rootless
Docker/Podman put the socket at `$XDG_RUNTIME_DIR` and cannot bind ports below 1024, and Docker
Desktop publishes into a VM with no meaningful public address.

Mitigation is a **preflight probe, not an assumption**: `GET /info` + `GET /version` yield OS type,
rootless flag, cgroup version, and storage driver — enough to detect most of the above. With
`COMPUTE_PROVIDER=docker`, a failed probe must error clearly at startup rather than 500 on first
deploy. Tier 2 platforms ship documented as unverified until someone actually runs them; guessed
instructions are worse than none.

## Sites

**A Site is not a Compute service — it is a pointer to an active deployment.** Compute is a running
service you mutate in place. A Site is a stable name whose deployments are immutable: create the new
one, build it, wait for healthy, then flip the pointer. Different publish flow, and the shape is the
same indirection as backend branching, though a different object.

```
site (stable name, domains)
  └─ active_deployment_id ──▶ deployment (immutable)
                                ├─ static → _sites/<deploymentId>/ in the bucket
                                └─ ssr    → a compute service (container:port)
```

### Resolving the non-goal tension

Non-goals cut deployment versions, preview, and rollback. The pointer indirection is nonetheless
required in v1, for a reason unrelated to rollback: **without it every site deploy has a window
where the site is down**, because updating in place means stopping the serving container before the
replacement is healthy. Atomic swap is a correctness property of deploying, not a version-history
feature.

So v1 keeps the two-table model and the swap, and **does not expose** activate, rollback, preview
URLs, or cancel. The rows exist; the API surface stays small. Retrofitting the indirection later
would be a migration.

The same distinction applies to cleanup: **reaping the previous deployment's container is required**
(otherwise every SSR deploy leaks one), while *retention policy as a user-facing setting* is
deferred. Keep-last-N with automatic destroy, no configuration.

### Static sites need no compute and no new ingress

Static output goes into the `_sites` bucket — which already works against local filesystem, MinIO,
or RustFS — and is served by a shared static gateway on the InsForge port. Since the operator's
existing proxy already fronts that port for the dashboard, **static sites require zero new
routing**, just a host or path rule they already know how to add.

Behaviours that must be handled properly: MIME types, `index.html` resolution, SPA fallback, 404,
and cache headers (immutable for hashed assets, revalidate for entry documents). ETags come from
the stored sha.

### Routing rules

- **Static site** → shared static gateway.
- **SSR site** → the active deployment's `container:port`, via the same label/routes mechanism as
  compute.

### Stable URLs

- **Generated domain** — derived from the site slug under the operator's configured sites domain.
- **Custom domain** — the operator adds an A or CNAME record. DNS guidance replaces Vercel's CNAME
  instructions with an A record at the operator's host.

### Deferred capability inventory

Recorded to substantiate the non-goals rather than to schedule work. Measured against Appwrite
Sites, v1 omits: multiple retained deployments with `waiting/building/ready/active/failed` states;
publish-then-activate with rollback; preview URLs for `ready` deployments; cancel / redeploy /
activate / source download; Git and `.tar.gz` entry points alongside CLI; framework auto-detection
(Next.js, Nuxt, SvelteKit, Astro) with inferred install/build/output settings; two-level and
build-vs-runtime variable scoping; domain rules bound to deployment/branch/redirect; the whole Git
workflow (GitHub App, push-to-deploy, PR previews, branch URLs); per-request HTTP logs and SSR
console capture; and runtime image allowlists with build/runtime timeouts.

v1's source entry point is the CLI, the developer supplies a Dockerfile, and variables are the
existing compute env vars.

## Implementation plan

**Phases 0–2 shipped in PR #1892. Phase 3 is design only.**

1. **Phase 0 — provider-neutral layer.** *Done.* Fly-specific naming moved out of the service layer
   into shared helpers (`flyAppNameFor`, `flyEndpointUrl`, `flyNetworkName` — placed in the shared
   module rather than on `FlyProvider` so the cloud provider can reuse them without dragging
   `fly.provider`'s imports into every consumer). Capability descriptor added; `fly_app_id` /
   `fly_machine_id` renamed with read-only `flyAppId` / `flyMachineId` aliases for one minor version;
   `provider` and `ingress` columns added; neutral `cpus` exposed; `COMPUTE_PROVIDER` added.

   **One migration, not two.** The draft split the rename and the ingress column across 064 and 065.
   They are consolidated into `064_compute-services-multi-driver.sql`, which is safe only because
   neither had been applied anywhere — migrations are recorded by filename, so replacing an applied
   064+065 pair with a single 064 would leave 064 recorded, the new file skipped, and the `ingress`
   column never created. Checked against the local stack and main before consolidating.

   **Capabilities are a metadata slice, not an endpoint.** The draft implied a dedicated route, and
   one was briefly built. `/api/metadata` already aggregates per-domain slices and the CLI already
   capability-probes through them — the `deployments` slice exists for exactly that — so a second
   "what can this deployment do" mechanism would have drifted from the first. Compute is now a slice,
   absent entirely when nothing is configured, which gives the same presence/absence signal without a
   request that would 503. It is synchronous and database-free, so it stays out of the aggregate's
   `Promise.all`.

   Keeping capabilities on the wire at all was questioned once the provider set turned out to be
   closed (`fly | docker`, an enum callers already have). It survives because capability *values* are
   not frozen: Docker's `sourceBuild` changed from `none` to `context-upload` during this work, and
   `deployTokenIssuance` differs for the *same* provider name — false on self-hosted Fly, true on
   cloud. A caller-side constant table keyed by provider cannot express either, and would be silently
   wrong across the version skew that is routine when an operator's backend and a developer's CLI
   upgrade on different schedules.

2. **Phase 1 — Docker driver.** *Done.* Image deploys, lifecycle, logs and events, label ownership,
   network attachment, reconcile, preflight, per-service ingress, and the socket mount across five
   compose variants. The optional bundled Caddy profile was **not** built — with ingress defaulting to
   `none` and the operator owning the gateway, nothing in v1 requires it.

3. **Phase 2 — source build.** *Done.* `POST /api/compute/services/:id/build` takes the context
   tarball as the request body — the build endpoint's native input, so it streams through with no
   intermediate copy — paired with the existing `POST /deploy` to reserve the name first.

   **Builder decision — reversed 2026-08-07 on a cold host.** The 2026-08-06 round chose BuildKit
   (`version=2`) after comparing progress format and error reporting, both of which favoured it. That
   comparison missed the deciding property. Measured on a host with the base image absent:

   ```
   version=2  →  {"error":"nginx:alpine: no active sessions"}
   version=1  →  builds, having pulled the base image itself
   version=2 with the base image already local  →  builds
   ```

   BuildKit resolves `FROM` through the gRPC session `docker build` establishes over `/session`; a
   plain POST has no session, so it cannot pull base images at all. **The classic builder is what
   shipped.** It also emits readable `{"stream":"Step 1/3 : …"}` progress, so the switch improved
   build logs rather than costing them. The cost is that Docker has signalled the classic builder for
   removal; the durable fixes are implementing the BuildKit session or shelling out to `buildx`, both
   recorded as follow-ups.

   Concurrency is capped at one build: two at once on a 2GB VPS is the difference between a slow
   deploy and an OOM. Superseded images are pruned after each successful deploy, since nothing else
   reclaims them and "the disk filled up" is otherwise a six-month-later support ticket.

   **The tag is not content-addressed by source.** The draft claimed identical source would reuse a
   tag. Tar embeds mtimes, so re-tarring the same files yields different bytes and a different digest.
   That is fine — BuildKit's layer cache is what makes an unchanged rebuild fast, and a unique tag per
   deploy gives prune a stable ordering — but the claim was wrong.

4. **Phase 3 — Sites.** *Design only.* Static output to the `_sites` bucket; SSR and container sites
   as compute services with a domain, behind the pointer model above.

Phase 0's renames touch three repos. **InsForge** is done; **CLI** (`flyAppId` in `compute/deploy.ts`,
the `flyctl` requirement, the `--region` default, and calling the new build endpoint) and
**insforge-mcp** (`get-container-logs`) are deliberately deferred until the backend settles, so
`compute deploy <dir>` does not yet work against the Docker provider — source build is API-only.
`insforge-cloud-backend` is untouched: the cloud and Fly paths behave as before, and an existing Fly
self-hoster who sets nothing new sees no change.

## Effort and risk

Phase 1 is small because it adds a driver behind an existing API, against an interface whose Fly
implementation is a working reference of the same shape, and Docker's Engine API maps onto it
roughly 1:1. Roughly 1–2 weeks with tests; risk concentrated in the two log gotchas and reconcile
correctness. Phase 2 is about a week, with one genuine unknown (below). Phase 0 is mechanically
simple but its release coordination costs more than its code. Sites is the largest piece — it is
the first consumer that needs the full routing chain, it depends on Phase 2, and
[deployment.service.ts](../../../backend/src/services/deployments/deployment.service.ts) is 1518
lines grown around Vercel's model (slugs, env vars, domain verification, history sync) with two
`isCloudEnvironment()` gates.

Most underestimated: Phase 0's cross-repo coordination; image GC and disk management (boring,
skippable, and the source of support tickets on small VPSes six months later); and the reconcile
loop, whose bugs only surface after a host reboot or a stray `docker system prune`.

## Verification status

**Engine API semantics** — Docker Engine 29.3.1 (linux/arm64, Docker Desktop VM), 2026-08-06: all
four gotchas above and the Phase 2 builder decision. These behave identically on any Linux daemon.

**Real host** — EC2 t4g.small, AL2023 arm64, Docker 25.0.16, via SSM; instance and security group
destroyed after the run:

- **Socket-in-container works.** A container with the socket mounted created a **sibling** (not
  nested) container, which appeared alongside it on the host daemon.
- **Label scoping is mandatory, and now demonstrably so.** From inside that container, an unfiltered
  `docker ps` listed the mock Postgres and the mock backend itself; `--filter label=insforge.managed=true`
  returned only the intended service. Without the filter, a delete could take out the database or
  the backend.
- **Ephemeral port assignment** — `-p 0:80` yielded 32768, read back from
  `NetworkSettings.Ports`. It binds **both** `0.0.0.0` and `[::]`, so `port` mode is dual-stack
  public by default; the bind-address knob must cover IPv6 too.
- **Service-to-service DNS** — `http://peer/` across a user-defined network returned 200, so
  discovery by container name works as assumed.
- **Security groups fail silently** — closed: `000` / curl exit 28 from host, container, and an
  external client alike. Opened: `200` from all three.
- **Hairpin works on EC2**, and the earlier claim to the contrary is corrected in Network and routing.
- **Reboot** — `unless-stopped` survived; no-policy containers stayed exited with `Exited (0)` or
  `Exited (137)` depending on shutdown grace.
- **Socket permissions / GID** — see the Docker driver section.

**End to end through the HTTP API** — isolated stack (own compose project, ports, and volumes; prod
target, socket mounted), torn down afterwards. This is the layer the earlier rounds did not cover,
and it is where the remaining bugs were:

- Migration applied by the real `migrate:up`; the provider registered at startup.
- `POST /api/compute/services` created a real container with correct labels; it attached to the
  project's compose network and reached `postgres:5432` and `postgrest:3000` **by name** — the first
  time own-container network discovery had actually succeeded rather than failing gracefully.
- `ingress: port` served 200 on loopback only; `ingress: none` published no port and advertised no URL.
- Source build: prepare → upload tar → build → launch → served the content the Dockerfile produced.
- Logs: zero frame-header bytes leaked; a cursor re-poll returned zero duplicates.
- An image update recreated the container onto the new image (new container id, `Config.Image`
  confirmed).
- Reconcile: a container removed out-of-band, backend restarted, row healed `running` → `stopped`
  with the dead pointer cleared.
- Delete removed both the row and the container.

**Two bugs only this layer could find:**

- **`scaleToZero` stored a value the provider cannot honour.** The API default for the field is
  `true`, and normalization only coerced an *explicit* `true` — so omitting it, which is the common
  case, stored `true` against Docker. Fixed by resolving the default at create time while leaving
  update-time semantics alone (on update, omitted means "leave it", and filling it in would turn a
  metadata-only PATCH into a deploy change).
- **The `group_add` instruction is Linux-only** — see the Docker driver section.

**Cold Linux host, review round (2026-08-07)** — EC2 t4g.medium, AL2023, Docker 25.0.16, the branch
checked out and the compose socket mount + `group_add` uncommented **exactly as the file instructs**,
with every test image deleted first. Instance and security group destroyed after.

This round exists because the earlier end-to-end pass ran on Docker Desktop, where the socket is
`root:root` and I used `group_add: ["0"]` — so the Linux instruction I actually ship had never been
executed. It now has: the backend came up as `uid=1000(node) groups=993` and reported the provider
ready.

**It also found the two worst bugs of the whole effort, both from one blind spot.** Every earlier
script — local, EC2, and Docker Desktop — ran `docker pull` before testing. That is not what a first
deploy does, and pre-pulling hid:

- `containers/create` not pulling, so creating a service failed with `No such image`.
- BuildKit being unable to pull `FROM` images without a session, so source build failed with
  `no active sessions`.

Both are fixed, and re-verified on a deliberately cold host: create pulled the image and served at
its published port, and a source build with the base image absent produced readable `Step …` logs and
served its own content. Reconcile and delete re-confirmed on Linux.

The lesson generalises past Docker: **a test that prepares the resource under test erases the state
real users start from.** Everything else here was measured carefully and still missed it for four
rounds.

**SELinux, now verified.** With `setenforce 1` on AL2023 the stack restarted, the provider reported
ready, and creating a container through the API succeeded — so the socket mount needs no `:z` / `:Z`
relabel. This is AL2023's policy under enforcing; RHEL and Rocky ship `container-selinux` with rules
that may differ, so they remain untested.

**Still unverified.** SELinux under RHEL/Rocky's own policy (the AL2023 result above is a
strong signal, not a substitute). Dokploy, Coolify, and Containarium remain unrun for compute, and the
Coolify and Dokploy compose files say so in their own comments rather than implying the mount is tested
there. Docker Desktop is now covered — see the local run at the end of this section.

**Bot review round (2026-08-07)** — 30 inline comments across three reviewers. Eight were real; the
notable thing is that six of the eight were mine to begin with rather than deep finds, and the two
highest-confidence bot claims were both wrong (a missing image pull that `ensureImage` already does,
and an `APP_KEY` requirement that predates this branch on `main`).

- **`resolveNetwork()` cached its own failure.** The `catch` wrote `null` into the same field as the
  success path, so one daemon blip during the first launch detached every later container from the
  project network until the process restarted — the exact outcome the lookup exists to prevent. Now
  the error path returns without caching.
- **`tail` + `since` dropped the middle of a log backlog.** See Gotcha 2.
- **A recreate left `status` stale.** The replacement branch persisted the new instance id and URL but
  not the status, so stop → redeploy reported `stopped` while the container ran.
- **Migration `provider` never applied `NOT NULL` on a rerun.** It used the single
  `ADD COLUMN IF NOT EXISTS … NOT NULL DEFAULT` form — the failure mode the comment three lines below
  it explains for `ingress` and defends against with a split add/backfill/constrain. Now both columns
  use the same pattern.
- **`DOCKER_SOCKET_PATH` was documented but not wired.** It existed only in `.env.example`; no compose
  file passed it, so overriding it did nothing. It now reaches the backend and drives the (still
  commented) mount on both sides, which is also what makes rootless Docker and Podman configurable.
- **The `DOCKER_GID` instruction was incomplete** — it showed a bare shell assignment, which Compose
  never sees. This one was self-evidenced: the cold-host round above only worked because I put the
  value in `.env` myself, which the file never told the operator to do.
- **`COMPUTE_DOMAIN` was missing from the prod file and all three deploy variants**, so `host` ingress
  could not produce a URL on any path a self-hoster actually uses.
- **A failed heal aborted the reconcile sweep.** `healMachineGone` was awaited inside the `catch`, so
  a DB error there escaped the loop and abandoned every remaining row.

Six new unit tests cover the behavioural four (network retry, both log-paging properties, the status
write, the heal guard); the compose changes are asserted against `docker compose config --format json`
on all five files rather than by grep, which is how the earlier misplaced-hunk mistake happened.

**Second bot round (2026-08-07)** — 30 more comments, mostly re-posts of claims already answered.
Six were real, and the best of them was a critique of a test written in the round above:

- **The new first-page log test asserted a shape no daemon produces.** It mocked a five-line body for a
  request carrying `tail=2`, then asserted the *oldest* two — but `tail=2` makes a real daemon return
  the newest two, so the trimming branch is unreachable on a first page. The product code was right;
  the test was theatre and would have passed through a regression. Replaced with a mock that *derives*
  its response from the request (`tail` → newest N, `since` → everything after that second), one test
  for the first page and one that pages a five-line backlog at `limit: 2` and asserts every line
  arrives exactly once. Confirmed to have teeth: restoring the old `tail`-plus-`slice(-limit)` code
  makes it fail with `['line-3','line-4']` while 0–2 never appear.
- **`endpointUrl` was persisted only alongside a replacement.** I dismissed this in round one on
  Docker-specific grounds — `ingress` is in the spec hash, so an in-place update cannot move the
  published port. Correct for Docker, wrong as a contract: nothing ties `updateMachine().endpointUrl`
  to a new instance id, so any driver that re-publishes in place would have its URL dropped. Hoisted.
- **A build context is buffered whole before any concurrency check.** The route borrowed
  `maxJsonBodySize` (100MB) and the driver's build cap only rejects once the body is already in memory,
  so N concurrent uploads cost N contexts — on a t4g.nano's ~418MB that is an OOM rather than a 429.
  Now: a dedicated `COMPUTE_BUILD_MAX_CONTEXT` (default 64MB, forwarded through all five compose files
  for the same reason `DOCKER_SOCKET_PATH` had to be) and a gate ahead of `express.raw` that turns away
  a second upload without reading it. The gate has to `req.resume()` — discovered by a hanging test,
  and true in production too: answering while the request body sits unread stalls the connection.
- **Built images leaked when the build succeeded but the deploy failed**, because the prune came after
  `updateService`. Moved into a `finally`. Docker refuses to delete an image a container is using
  (409, already logged and skipped), so this cannot pull the running image out from under a failure.
- **Reconcile's status-correction write was unscoped.** `healMachineGone` already carries
  `AND provider_instance_id = $2` — the conditional write the reviewer asked for existed — but the
  correction `UPDATE` beside it did not, so a stale `stopped` reading could overwrite the `running` a
  concurrent deploy had just committed. Same guard added.
- **The `dockerfile` query parameter reached the daemon unvalidated.** Now rejects absolute paths,
  `..` segments, empty values, and anything over 255 characters with a 400 that says what to fix.

Eighteen more tests, including the first HTTP-boundary coverage for `POST /:id/build` (body parse,
content type, tenant check, builder failure, every `dockerfile` shape, and the concurrency gate).
Both new guards were verified by reverting the fix and watching the test fail.

Notable among the invalid: the same "image is never pulled" P1 for the third time (`ensureImage()` has
preceded `containers/create` since the cold-host round), two claims that the compose forwarding was
missing *in the commit that added it*, and a Major on the migration's `SET NOT NULL` lock —
`Dockerfile:173` runs `migrate:up && exec node server.js`, so migrations finish before the server
process exists and there is no reader to block.

**Third bot round (2026-08-08)** — four comments, all new, all on the round-two code, and all correct.
The upload gate accounted for three of them, which is a fair verdict on inventing a concurrency
primitive in a route file.

- **An over-limit context returned 500.** `express.raw` rejects with `entity.too.large`, and the shared
  error middleware only recognises `entity.parse.failed` — so the operator who set the limit was told
  the server broke. Translated where the limit is known, into a 413 that names
  `COMPUTE_BUILD_MAX_CONTEXT`. (Fixed at the route rather than in the shared middleware, matching how
  `upload.ts` and the storage routes already convert their own size errors.)
- **The gate released on response close, which is wrong in both directions.** A client that disconnects
  mid-build reopened the slot while the daemon was still working, admitting a second full context; a
  client that stalled mid-upload held it indefinitely. Now the release has two owners: until the
  handler takes over (`buildStarted`), the socket closing releases it; after that, the handler's
  `finally` does. An idle timer — reset on every chunk, cleared once the body is read — destroys a
  connection that stops making progress, so a slow-but-steady upload is never penalised and a stalled
  one cannot wedge the endpoint. The timer is the one piece here with no unit test; it would need a
  30-second wait.
- **The reconcile guard added in round two counted skips as corrections.** The whole point of
  `AND provider_instance_id = $3` is that it sometimes matches nothing, and `stats.corrected++` ran
  anyway — reporting work that never happened and hiding how often the race fires. Now keyed on
  `rowCount`. Two existing test mocks omitted `rowCount` entirely and landed in the "corrected" branch
  by accident; both now return what pg would.
- **The reopen assertion in my own gate test raced a fixed 20ms sleep.** Replaced with a bounded poll.
  Written the same day I watched an unrelated limiter test flake under full-suite load, which is
  exactly the failure mode.

All three code fixes were verified by reverting them and watching the corresponding test fail.

**Fourth bot round + a second cold-host run (2026-08-08)** — EC2 t4g.medium, AL2023, Docker 25.0.14,
`docker-compose.prod.yml` built from the branch with the socket mount and `group_add` uncommented
exactly as the file instructs. Instance and security group destroyed after.

Both deploy sources were exercised on a host that had never seen the images:

- **Image source.** With `nginx:alpine` deleted first, create pulled it and served 200 on the published
  loopback port — and refused on the host's private IP, so the loopback bind default holds. Labels
  scoped correctly, the container joined `insforge_insforge-network`, and `postgres` resolved by name
  from inside it. An image change recreated the container (new id, new port, row followed). Stop →
  redeploy came back `running`, which is the round-two status fix confirmed end to end. Delete removed
  row and container.
- **Source build.** With `alpine:3.20` deleted first, the uploaded context built through the classic
  builder — readable `Step 1/3 …` output, `Successfully tagged insforge-e2ekey01/srcsvc:2bdbedafa676` —
  and the container came up running that tag with the file the Dockerfile baked. This is the case
  BuildKit could not do at all (`no active sessions`), so the builder reversal is now verified twice on
  cold hosts.
- **Log paging, the riskiest recent change, confirmed against a real daemon.** Paging a twelve-line
  backlog at `limit=5` from a cursor older than everything delivered 1–5, 6–10, 11–12, then empty:
  every line exactly once, oldest first. Under the old `tail`+`since` code page one would have been
  8–12 and lines 1–7 unreachable forever.
- **The three guards.** Over-limit context → 413 naming `COMPUTE_BUILD_MAX_CONTEXT` (not the 500 it was
  before round three); a second upload during a build → 429, and accepted again once the build
  finished; `..`, absolute, and empty `dockerfile` values → 400 with actionable messages.
- **Migrations, prune, reconcile.** Two restarts re-ran migrations with zero errors, and `provider` and
  `ingress` both read `is_nullable=NO` on a real database — the round-one migration fix in situ. Prune
  held at two images per service across several builds. Reconcile checked the live row and corrected
  nothing. Nothing outside the label scope was touched.

**What the live run failed to prove.** I tried to verify the idle watchdog by stalling an upload and
could not construct a stall: curl sent its partial body and saw EOF, and the truncated 2048-byte tar
still contained the whole Dockerfile, so it built successfully. That branch needs socket-level control,
which is a unit test, not an SSM script — which is exactly what the round-four review asked for.

Two comments, both cubic, both on that gap and both correct:

- **The abort and stall branches had no coverage.** Added two tests driving a real listener with
  `http.request` and a `Content-Length` deliberately underfilled: one drops the socket while the request
  is parked in `express.raw` and asserts the slot is handed back; one sets the timeout to its smallest
  value and asserts the watchdog destroys the request and frees the slot. Both verified by reverting the
  corresponding branch.
- **The 30s timeout was hard-coded while the size limit beside it was config-driven.** Now
  `COMPUTE_BUILD_UPLOAD_IDLE_TIMEOUT` (seconds, default 30), forwarded through all five compose files.

Two things I got wrong earlier, corrected here:

- **`COMPUTE_ISOLATE_NETWORK === 'true'`.** I dismissed this twice by checking the codebase-wide
  convention; `app.config.ts` has its own `parseEnvBool` helper accepting `1/true/yes/on`, six lines
  above, and my line was the outlier. A knob that silently ignores `=1` fails in the unsafe direction.
  Now uses the shared parser.
- **The `DOCKER_GID` instruction produced a duplicate key.** Following my own fixed instruction on the
  live host appended a second `DOCKER_GID` line beside `.env.example`'s placeholder. Compose takes the
  last, so it worked — but the instruction now says to fill in the existing line instead of appending.

**Docker Desktop / macOS, local (2026-08-08).** Engine 29.3.1, arm64, run as a second isolated stack
(own compose project, its own ports and volumes) alongside a dev stack already running on the same
daemon. Both deploy sources passed with no new defects. Two things this covered that neither EC2 round
could:

- **Label scoping under a genuinely shared daemon.** Nine containers were running — the dev stack, this
  stack, and the compute container — and `label=insforge.managed=true` matched exactly the one this
  driver owned. On a clean EC2 host that filter has nothing to get wrong; here it did.
- **`COMPUTE_PUBLIC_HOST`, exercised for the first time.** Every prior run left it unset, so
  `endpointUrl` was always `null` — correct by design, but it meant the round-one fix that persists a
  port-ingress URL had never actually produced one. Set to `localhost`, a `port` service came back with
  `http://localhost:49912`, and that URL answered 200.

**Fifth bot round (2026-08-08)** — two comments, both correct, both on round-four code.

- **An oversized `COMPUTE_BUILD_UPLOAD_IDLE_TIMEOUT` inverted the setting.** `setTimeout` treats any
  delay past the 32-bit signed max as 1ms — measured: `3_000_000_000` fires in 6ms with a
  `TimeoutOverflowWarning` — so an operator configuring a *lenient* timeout would have had every upload
  aborted instantly. Clamped at load.
- **Both tests I added last round used a fixed `setTimeout(50)`** to establish "the slot is held" before
  asserting 429 — the same fixed-sleep race this file's own helper warns about, and which I had fixed
  elsewhere in the very same round. They now poll until a probe is actually turned away. One knock-on:
  the abort test's "never called" assertion had to become a delta, because a probe that races ahead of
  the partial upload legitimately takes the slot and builds once, which says nothing about whether a
  *rejected* upload reaches the service.

That makes three rounds in a row where the best finding was about code or tests I had just written, and
two where the finding was a pattern I had criticised elsewhere in the same commit.

**Contract and consistency gaps closed (2026-08-08).** Four items previously logged as "accepted but
not worth acting on" or "small gap before merge", all of them mine and none needing a product decision:

- **`openapi/metadata.yaml` did not describe the `compute` slice**, though it enumerates `auth`,
  `database`, `storage`, `functions`, `realtime` and `deployments`. Added with the per-provider
  capability shape and an example. Note for whoever picks up the docs work: there is no
  `openapi/compute.yaml` at all, so the build endpoint's absence from the contract belongs to that
  pre-existing hole rather than to this branch.
- **The markdown metadata export omitted compute.** It now renders a Compute section phrased as what a
  client should stop offering (`regions no`, `scale-to-zero no`) rather than dumping the object, and
  stays absent when no driver is configured, since absence is the signal.
- **`listMachines` used an unanchored Docker name filter**, so `api` also matched `api-v2`. Anchored,
  allowing for the leading slash Docker puts on container names, with an exact-match filter behind it.
  No caller today — this was a trap waiting for one.
- **The `ingress` docblock sat between `protocol`'s docblock and `protocol`**, so the Edge-protocol text
  documented the wrong field and `protocol` was left undocumented. Reordered; `updateServiceSchema` was
  already right.

**Deliberately not closed, with reasons.** `createApp`'s returned `appId` is still discarded by both
create paths: it is pre-existing on `main` and only reachable through the cloud provider, so changing it
would alter cloud behaviour from inside a self-host PR. The idle watchdog is not separately verified on
a containerised host, because the unit test drives a real listener over a real socket and the container
boundary is not part of the code under test. SELinux under RHEL/Rocky policy and the tier-2 platform
matrix (Dokploy, Coolify, Containarium) remain open, as does the whole deferred bucket — CLI, docs,
dashboard gating, Phase 3 Sites.

Also confirmed on this platform: `group_add: ["0"]` is required because the Desktop socket is `0:0`
inside the container rather than Linux's `root:docker` (the documented difference, re-measured); a
macOS-produced context (`COPYFILE_DISABLE=1 tar --no-xattrs`) built without the xattr failure; cold
pull, cold `FROM`, log paging through a 12-line backlog at `limit=5`, 413, 429, `dockerfile` rejection,
prune holding at two images, and delete removing row and container. The stack, its volumes, and every
image it produced were removed afterwards; the pre-existing dev stack and image cache were untouched.

## Open questions

1. **Auto-inject project credentials?** The compute overview already promises containers receive the
   project URL, a service-role JWT, and S3 credentials. Joining `insforge-network` by default makes
   the injected addresses resolve, so confirm whether the Docker driver should do this. Still open —
   nothing is injected today beyond what the caller passes.
2. **Registry for built images.** Daemon-resident is simplest for one box; a local registry is needed
   the moment multi-host appears.
3. **How should the CLI avoid the self-host Fly wedge?** Either branch on `deployTokenIssuance` from
   the metadata slice, or tolerate the 400 and fall back to the operator's own flyctl credentials. The
   second is more robust against an older backend that lacks the field; the first avoids a failed
   request. Not decided, and it is CLI work either way.
4. **A failed create keeps the name.** `createService` marks its row `failed` and leaves it, so a
   typo'd image reference burns the service name until someone deletes it — the review round hit this
   as a `409 COMPUTE_SERVICE_ALREADY_EXISTS` on retry. `prepareForDeploy` does the opposite and
   deletes its row on failure, so the two paths disagree. This is inherited Fly behaviour rather than
   something the Docker work introduced, but the pull fix makes it easier to reach (a bad reference
   now fails predictably instead of succeeding whenever the image happened to be cached). Worth
   deciding: delete on failure, or keep the row for the audit trail and accept the name being held.

5. **Sites generated domains without wildcard DNS.** Subdomain-per-site needs `*.domain`. Fallback —
   path-prefix routing, or port-per-site?

## Follow-up work, in the order it blocks things

1. **CLI** — read the metadata slice, stop sending `--region` and `--always-on` where the provider
   cannot honour them, call `POST /:id/build` for source deploys, and fix the self-host Fly wedge
   (including widening its rollback to cover everything after `prepareForDeploy`). Until this lands,
   `compute deploy <dir>` does not work against the Docker provider.
2. **Docs** — the compute overview still says containers run on Fly.io. Needs the Docker provider, the
   three ingress modes, the platform tiers, the Linux/Desktop `group_add` difference, and the volume
   limitation stated plainly. The dead
   `docs.insforge.dev/core-concepts/compute/architecture` link is still dead.
3. **Dashboard** — gate on the metadata slice instead of showing options the provider cannot deliver
   (region, the scale-to-zero toggle, a null endpoint URL).
4. **Phase 3 Sites** — unchanged design; depends on nothing in this list.

## 2026-08-11 — DOCKER_GID deleted, not defaulted

Lyu asked whether the socket mount could just be on by default, and whether `DOCKER_GID`
had a sane default. Decisions: mount stays opt-in, GID goes away.

**Opt-in stays.** The socket is root-equivalent on the host. On by default would hand
every self-host deployment's backend the ability to take over its host whether or not
it uses compute. Separately it could not have worked as written: `group_add:
["${DOCKER_GID:?...}"]` makes compose refuse to start when the variable is unset, so
flipping the mount on would have broken every existing deployment on upgrade.

**No default GID — the container reads it.** No single value is right: 0 on Docker
Desktop (socket is `root:root`), commonly 999 on Debian/Ubuntu, 993 on Amazon Linux
2023. A wrong value is a silent `EACCES`, which surfaces as "Docker never appears in
the dashboard". `docker/entrypoint.sh` now starts as root, reads the socket's group with
`stat -c %g`, joins it, and `exec su-exec node "$@"`. `USER node` is gone from the
runner stage; the app process is still `node`.

Verified on a build of `target: runner`:

| case | result |
| --- | --- |
| no socket mounted | `uid=1000(node)`, unchanged |
| socket gid 0 (Docker Desktop) | `groups=0(root),1000(node)`, socket writable |
| socket gid 999 (Linux, group exists) | joins it, socket writable |
| old behaviour (`USER node`, no entrypoint) | **socket denied** — the EACCES the GID step existed to avoid |

Then end to end from that image against the live database: `Compute provider "docker"
ready`, metadata slice present, a service created and serving on its published port,
app process still `node`, `tini` still PID 1.

Consequences recorded: `docker exec` into the container now lands as root rather than
node, and `su-exec` is a new package in the runner stage. `group_add` and `DOCKER_GID`
are gone from all five compose files, `.env.example`, the docs in four languages, the
dashboard guide (three steps to two), and the not-configured API message.
