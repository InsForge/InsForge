# Self-Host Backend Branching — Design

**Date:** 2026-08-10
**Status:** Draft

> **Prior art:** backend branching is already shipped on cloud. The product semantics live in
> `insforge-cloud-backend: docs/branching/Backend-Branching.md` (PRD) and
> `docs/superpowers/specs/2026-04-29-backend-branching-cloud-design.md` (cloud slice). **This design
> does not re-decide any of it** — mergeable matrix, 3-way diff, conflict policy, reset semantics and
> the state machine are taken as given. What changes is the provisioning layer.

**Essence:** a branch is another **database in the same Postgres cluster**, selected per request by
one middleware. One backend process, one URL, one dashboard.

## Goals (v1)

1. Create a branch from the live project in seconds, in two modes: full data copy and schema-only.
2. Anything a developer or agent does on a branch — DDL, RLS, migrations, records, auth config —
   leaves `main` untouched.
3. Merge a branch back into `main` with the cloud 3-way diff, blocking on conflict.
4. Discard a branch, and reset a branch back to T0.
5. Branches are visible and switchable from the dashboard, CLI, and MCP.

## Non-goals (v1)

- Realtime, schedules, and the S3 protocol gateway on branches (see Feature matrix for why each is
  blocked rather than merely unimplemented).
- Nested branches, auto-branching, branch expiration, revert-to-deleted-branch. Same exclusions as
  cloud v1.
- Instant (copy-on-write) branch creation. Recorded as a follow-up path, not a v1 mechanism.
- Compute and Sites deploys following a branch — cloud v1 already requires a manual redeploy.

## Why cloud's answer is not this answer

Worth recording, because "cloud made a branch a whole project, so self-host should too" is the
default assumption and it is wrong here.

Cloud's identity unit is the **appkey**, and appkey determines the hostname
(`{appkey}.{region}.insforge.app`), the S3 prefix (appkey is the first-level directory), and the key
set — the PRD regenerates `API_KEY` / `ANON_KEY` per branch and rewrites `INSFORGE_BASE_URL` /
`INSFORGE_INTERNAL_URL`. Those are process-level env, so one backend process holds exactly one of
them; a second appkey needs a second instance. Cloud also had instance provisioning already built
(warm pool, `createProject`, SSM backup/restore), so "branch = new project row" inherited pause,
resume, quota, region and cascade delete for free. And a same-cluster branch there would spend a
paying customer's *production* instance — a t4g.nano has ~418MB usable, of which the platform
already takes ~230MB.

Self-host inverts all three: one cluster, one process, one URL, and the operator is the developer
(the same trust-domain premise the compute driver design argues from). Two cluster-level facts make
the database route cheaper still — see Verified foundation.

**The cost we inherit and cloud avoided:** main and branch share one API key and one ANON key.
Cloud's separate keys exist precisely to stop an SDK from silently addressing the wrong
environment. The mitigations here are the 404-on-unknown-branch rule and the response echo below;
there is no key-level separation. State this in the docs plainly.

## Verified foundation

Read 2026-08-10 against `feat/compute-fly-credentials-dialog`.

**Roles are cluster-level.** `anon` / `authenticated` / `project_admin` come from
[db-init.sql](../../../deploy/docker-init/db/db-init.sql), which runs once per *cluster*. `pg_dump`
emits GRANTs but not `CREATE ROLE`, so restoring into a new database in the same cluster resolves
every ACL with no role setup.

**`app.encryption_key` is a cluster-level GUC** — [docker-compose.yml](../../../docker-compose.yml)
passes it on the postgres command line. So encrypted `system.secrets` and
`schedules.jobs.encrypted_headers` decrypt inside a branch database unchanged. Cloud has to
decrypt-then-re-encrypt across clusters; here that step disappears entirely.

**JWT_SECRET is shared by construction** (same process), so the PRD requirement that parent-issued
JWTs authenticate parent users on the branch is satisfied with no work.

**Event triggers and extensions are database-scoped and `pg_dump` carries them**, so
`create_default_policies` and the migration-056 schema-exposure trigger keep working on a branch.

**`getPool()` has 407 call sites across 50 files.** Threading a branch parameter through them is not
viable; resolving the pool *inside* `getPool()` is, which is what makes the whole design cheap.

**One mount point.** [server.ts:251](../../../backend/src/server.ts#L251) is the only
`app.use('/api', apiRouter)`.

**PostgREST is one database per instance.** `PGRST_DB_URI` is fixed at boot and v12 has no
multi-database mode, so branch data-API traffic needs its own PostgREST process. Migration
[056](../../../backend/src/infra/database/migrations/056_expose-custom-schemas-to-postgrest.sql)
makes the *schema* allowlist dynamic, not the database.

**Connection budget is tight.** [postgresql.conf](../../../deploy/docker-init/db/postgresql.conf)
sets no `max_connections`, so it is the default 100. The main PostgREST alone defaults to
`PGRST_DB_POOL=50`, plus the backend pool at 20.

**`pg_cron` is single-database.** The same conf pins `cron.database_name = 'insforge'`, and
[migration 021](../../../backend/src/infra/database/migrations/021_create-schedules-schema.sql#L304)
calls `cron.schedule()` in-database. The `cron` schema only exists in `insforge`, so schedule
writes from a branch database fail with `schema "cron" does not exist`.

**The Deno runtime resolves its own database from env.**
[functions/server.ts:75](../../../functions/server.ts#L75) reads `POSTGRES_DB` and queries
`functions.definitions` itself, so a branch invocation would execute `main`'s code.

**Storage branch mode exists but only for S3.**
[storage.service.ts:47](../../../backend/src/services/storage/storage.service.ts#L47) already
implements read-fallback to a parent prefix via `PARENT_APP_KEY` (cloud plan item 4, shipped in
OSS); line 62 says the local filesystem provider has none, "local installs aren't branched" — which
is the default self-host configuration.

**`pg_dump`/`pg_restore` plumbing is already here.**
[database-backup.service.ts:766](../../../backend/src/services/database/database-backup.service.ts#L766)
(`runPgTool`) spawns both with `PGPASSWORD` from `appConfig.database`.

**The metadata write-back problem is already solved once.**
[restoreBackup](../../../backend/src/services/database/database-backup.service.ts#L266) snapshots
`system.database_backups` and `system.database_config` around a restore, because the dump contains
them. `system.branches` needs the same treatment (below).

**The SDK already forwards arbitrary headers.** `InsForgeConfig.headers` (`InsForge-sdk-js:
src/types.ts:90`) is merged into `defaultHeaders` in the HTTP client constructor, so branch
selection by header needs **no SDK change**. Note for the record that a path prefix *would* have
needed one: `buildUrl` is `new URL(path, this.baseUrl)` with an absolute `/api/...` path, which
discards any path component of `baseUrl`.

## Architecture

### A branch is a database

`insforge` (main) and `insforge_br_<slug>` per branch, in the one cluster.

Creation is `CREATE DATABASE` + `pg_dump | pg_restore` through the existing `runPgTool`. Schema-only
mode is the same dump with `--exclude-table-data` for each entry of cloud's
`SCHEMA_ONLY_DROP_DATA_TABLES` (`mergeable-matrix.ts`) — dumped small rather than restored and
truncated, matching what `schema-backup-db.sh` does on cloud. The dump is retained as the T0
artifact in the backup bucket (`_database_backups`) so `reset` has something to restore.

**Rejected — schema-per-branch inside one database** (`br_x_public`, `br_x_auth`, …). Postgres has
no clone-schema primitive, so it degenerates into rewriting dump text: user tables carry FKs to
`auth.users`, policies call `auth.uid()`, and function bodies are schema-qualified, so all of them
would keep pointing at main. `pg_dump -n` also omits event triggers. Worse isolation than the
database route, for more code.

**Rejected — `CREATE DATABASE … TEMPLATE insforge`.** Tempting as an instant clone, but it requires
zero sessions on the template database, which never holds on a live stack. Recorded so it is not
retried.

**Rejected — `postgres_fdw` to expose branch tables inside main** and route with `Accept-Profile`.
RLS is evaluated on the remote side by the remote user and `request.jwt.claims` does not propagate;
DDL does not follow either.

### Branch selection is one middleware

`x-insforge-branch: <slug>`, resolved into an `AsyncLocalStorage` store, then:

```ts
getPool(): Pool {
  const branch = branchContext.getStore()?.branch;
  return branch ? this.branchPools.get(branch)! : this.pool;
}
```

All 407 call sites are untouched. Three rules on resolution, because the default is the dangerous
direction:

- **No header → main.**
- **Header present but branch unknown → 404.** Never fall back to main.
- **Every response echoes `x-insforge-branch`** with the branch that actually served it, so CLI,
  MCP, and the dashboard can assert rather than assume.

Additive later, same resolution point, no architectural change: a `/branches/:name/api` mount (needs
the SDK URL-join change), or a port per branch (zero SDK change, needs a published port range).

Two things that do not come free:

- **Background work runs outside a request** and must stay on main: the backup scheduler and
  retention sweeps, and the realtime LISTEN client
  ([realtime.manager.ts:51](../../../backend/src/infra/realtime/realtime.manager.ts#L51)) via
  `createClient()`.
- **The two static caches in
  [database.manager.ts](../../../backend/src/infra/database/database.manager.ts#L61)** key on
  `schema.table` (`buildQualifiedTableKey`). Column types and row counts would leak across branches;
  the branch has to enter the cache key.

### PostgREST per branch

One container per branch, created through the Docker client the compute driver already ships
([docker.client.ts](../../../backend/src/providers/compute/docker.client.ts)) with the same
`insforge.managed` / project label scoping, on `insforge-network`.
[postgrest-proxy.service.ts:9](../../../backend/src/services/database/postgrest-proxy.service.ts#L9)
reads the base URL into a module-level constant today; it becomes a per-branch lookup.

`PGRST_DB_POOL` for a branch is 5–10, not the default 50 — the budget is 100 connections total, and
main already claims 70. Branch count therefore needs a configured ceiling.

Where no Docker socket is mounted (tier-3 platforms: Zeabur, Railway, Kubernetes — see the compute
design's platform tiers) branches still work for everything served by the backend's own pool: SQL
editor, DDL, migrations, table and record editing through the admin path, auth config. Only the
PostgREST data API is unavailable. **This degradation is reported explicitly on branch create**, not
discovered at first query.

### `system.branches`

In main's `system` schema, mirroring cloud migration 058 minus the project plumbing: slug, name,
state (`creating|ready|merging|merged|conflicted|resetting|deleted`), mode (`full|schema-only`),
`parent_t0` JSONB (fingerprint + migrations head + captured_at + dump artifact key),
`created_at`.

`pg_dump` copies this table into every branch database, so a branch would otherwise report owning a
list of branches. Clear it in the branch after restore — the same class of problem, and the same
fix, as the `system.database_backups` write-back in `restoreBackup`.

## Feature matrix

| Module | v1 | Why |
| --- | --- | --- |
| database — DDL, RLS, migrations, SQL editor, table/record editing | yes | The whole point; all of it lands in the branch database |
| database — data API (`/api/database/records`) | yes, with a socket | Needs the per-branch PostgREST; degrades explicitly without it |
| auth | yes | Branch database carries `auth.users` + config; JWT_SECRET shared. OAuth `client_id` / `secret` / `redirect_uri` are per-environment and already excluded by cloud's matrix |
| storage — buckets/config metadata | yes | Travels with the database |
| storage — objects | no | Local provider has no parent read-fallback; S3 mode already does via `PARENT_APP_KEY` |
| functions | no | Deno resolves its database from env; needs the branch database name passed per invocation |
| schedules | no, and blocked at the API | `cron` schema exists only in main, so a branch write raises a raw Postgres error |
| realtime | no | Single LISTEN client; per-branch listeners needed |
| S3 protocol gateway | no | Signed requests cannot carry the branch header |
| compute / Sites | no | Out of branching scope per the PRD; redeploy manually |

Blocked-not-broken matters for schedules: the branch must reject schedule writes with a real error.
Leaving it to fail inside Postgres surfaces `schema "cron" does not exist` to the developer. The
inertness itself is correct — a branch firing the same cron jobs at the same real HTTP endpoints
would be worse.

## Merge, reset, discard

Semantics are cloud's, unchanged: 3-way diff over T0 fingerprint / parent-now / branch-now; conflict
blocks the whole merge with `rendered_sql` carrying the `-- ⚠️ MERGE BLOCKED` banner; data never
reaches parent; `table:modify` and every `drop` stay skipped per the auto-apply matrix; all applied
SQL is idempotent.

Self-host simplifications: both databases live in one cluster, so the merge engine gets two pools
instead of cloud's SSM-mediated introspection, and there is no re-encryption step.

- **discard** — `DROP DATABASE` plus removing the branch's PostgREST container.
- **reset** — restore the retained T0 artifact into the branch database in place; `schema-only`
  re-runs the truncate step. Never touches main.

**Engine location — decided 2026-08-10:** copy `fingerprint.ts`, `branch-diff.service.ts`,
`merge-sql-builder.ts`, `mergeable-matrix.ts`, `schema-only-truncate.sql` and
`branch-reset-pre-wipe.sql` into OSS for v1 and accept two implementations short-term, rather than
blocking on extracting a shared package. They depend on nothing but a `pg.PoolClient`, so the copy
is mechanical. The drift risk is real and named: `mergeable-matrix.ts` and
`SCHEMA_ONLY_DROP_DATA_TABLES` are the entries most likely to diverge, since both repos edit them
whenever an OSS schema gains a config table. Land a test that asserts the OSS copy covers every
schema in `insforge.internal_schemas`, so a new internal schema cannot silently default to
never-mergeable in one repo only.

## Operational consequences

**Upgrades must migrate every branch database.** `migrate:up` runs `node-pg-migrate` against a
single `DATABASE_URL` ([backend/package.json:22](../../../backend/package.json#L22)). Left alone, a
branch database stays on the internal schema it was cloned at while new code reads it. Boot has to
iterate `system.branches` and migrate each, and a branch whose migration fails must be marked rather
than silently served.

**Disk.** Full mode is a full copy per branch on the same volume. Schema-only is near-constant and
should be the default offered in the dashboard and CLI.

**Creation time is O(data).** Seconds to tens of seconds at dev scale (<1GB); schema-only is 1–2
seconds. Genuine instant branching needs copy-on-write — a ZFS or btrfs snapshot of PGDATA plus a
second postgres container, Linux-and-CoW-filesystem only. Follow-up path, not v1.

## Implementation plan

1. **Phase 0 — branch context.** `system.branches`, the header middleware with the three resolution
   rules, `getPool()` resolution, per-branch pool registry, branch-keyed static caches, background
   jobs pinned to main.
2. **Phase 1 — lifecycle.** create (full + schema-only), list, delete, reset, T0 artifact retention.
   At the end of this phase "open a branch, change the database, discard it" is complete.
3. **Phase 2 — data API on branches.** Per-branch PostgREST via the Docker client, pool sizing,
   branch ceiling, explicit degradation without a socket.
4. **Phase 3 — merge.** Port the engine, wire dry-run and apply, add the internal-schema coverage
   test.
5. **Phase 4 — deferred modules.** Local storage read-fallback, branch database name passed to the
   Deno runtime, schedules and realtime.

Dashboard and CLI work runs alongside phases 1–3. CLI note: `branch switch` on cloud swaps
`.insforge/project.json` after `requireAuth` against the platform API, so the self-host path is a
new branch in that command, not a reuse.

## Open questions

1. **Branch ceiling.** Driven by `max_connections` (100) and disk. Is a configured cap enough, or
   should `postgresql.conf` raise `max_connections` as part of this work?
2. **Does a branch get its own anon key?** v1 shares main's. A per-branch ANON key would restore the
   protection cloud gets from key separation, at the cost of key management self-host does not have
   today.
3. **Local storage fallback in v1 or not.** It is a few dozen lines mirroring the S3 path, and
   without it a branch sees zero files, which will read as a bug.
4. **Dashboard switching model** — a global branch selector versus per-feature. Cloud's UX brief
   points at Supabase; self-host has the advantage of one URL and can be more direct.
