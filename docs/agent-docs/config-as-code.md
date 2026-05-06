# `insforge.toml` — config as code

Declarative project configuration. Read by agents, edited in PRs, applied with one command. The DB stays the source of truth; the file is the *intent layer*.

## TL;DR

```bash
insforge config export        # live → insforge.toml
insforge config plan          # show file ↔ live diff
insforge config apply         # plans, confirms, applies
```

`apply` always shows the plan first and prompts for confirmation. `--auto-approve` skips the prompt (CI/agents). `--dry-run` shows the plan and exits.

## What goes in the file

```toml
project_id = "proj-abc123"

[auth]
additional_redirect_urls = ["https://app.example.com", "http://localhost:3000"]

[storage.buckets.avatars]
public = true

[storage.buckets.user-files]
public = false
```

That's the v1 surface. Everything else (OAuth providers, function metadata, more bucket properties, schedules) lands in follow-up plans as DB columns are added.

## What does NOT go in the file

| Thing | Where it lives | Why |
|---|---|---|
| Table schemas, columns, indexes | `migrations/*.sql` | Too many shapes for a finite knob set |
| RLS policies | `migrations/*.sql` | SQL expressions, not enums |
| Triggers, grants, DB extensions | `migrations/*.sql` | Same |
| Function code | `functions/<name>/index.ts` | Code |
| Row data | nowhere — it's data | Not configuration |
| Secret values | env / secret store | TOML uses `env(NAME)` references only |
| Ad-hoc fixes, exploration | `insforge run-raw-sql` | Imperative escape hatch |

**Hard rule:** TOML never embeds SQL. If a value is itself a program, it's a path to a file (`policy_file = "policies/owner_only.sql"`), never the SQL itself.

## Three slots, one job each

| Slot | Owns | Reproducible? | Reviewable? |
|---|---|---|---|
| `insforge.toml` | declarative knobs | yes — `insforge config apply` | yes — TOML diff in PR |
| `migrations/*.sql` | schema, policies, code | yes — `insforge db push` | yes — SQL diff |
| `insforge run-raw-sql` | exploration, one-off fixes | no, by design | no, that's fine |

## Drift handling (the part Supabase gets wrong)

Dashboard edits stay live and **never get silently overwritten**:

- `insforge config plan` always shows the full file ↔ live delta. If a teammate flipped a setting in the dashboard, you see it as a `~` modification before applying.
- Items present in the DB but missing from the file are **kept by default**, marked `KEPT; use --prune to delete`. Pruning is opt-in.
- `apply` runs `plan` first and prompts for confirmation. `--auto-approve` skips the prompt; `--dry-run` skips the apply.

This is the main behavioral departure from Supabase's `config push`, which silently overwrites and has no equivalent of `--prune` opt-in (see e.g. [supabase/cli#3208](https://github.com/supabase/cli/issues/3208), [supabase/cli#4407](https://github.com/supabase/cli/issues/4407)).

## Idempotence

All operations are upsert-style. Running `apply` on a converged state is a no-op (`No changes. Live state matches insforge.toml.`). This is enforced by tests and by the server-side apply orchestrator using upsert semantics for every section.

## Concurrency

Each `apply` takes a Postgres advisory lock keyed on `(project, "config_apply")`. Two concurrent `apply` calls serialize; calls for different projects run in parallel.

## Wire format

CLI parses TOML → normalized JSON → POSTs to:

- `GET  /api/config` — returns `{ config: <JSON> }`, current live state
- `POST /api/config/apply` — body `{ config, dry_run, prune }`, returns `{ plan, applied }`

The CLI calls apply twice on a non-`--dry-run` invocation: once with `dry_run: true` to render the plan and prompt, then once with `dry_run: false` to actually apply. This means the user always sees what's about to happen.

`--json` on any command produces machine-parseable output for agents.

## Status (v1)

**Working:**
- `[auth] additional_redirect_urls`
- `[storage.buckets.<name>] public`
- All commands: `export`, `plan`, `apply` (with `--dry-run`, `--auto-approve`, `--prune`, `--json`)

**Not yet wired (need DB columns):**
- `[auth] jwt_expiry`, `enable_signup`, `site_url`

**Deferred to later plans:**
- `[auth.external.<provider>]` — OAuth providers
- `[functions.<name>]` — per-function metadata
- `[storage.buckets.<name>]` — `file_size_limit`, `allowed_mime_types`
- Three-way diff with `last_applied` snapshot (only build this if drift complaints come in)

## See also

- Design spec: `docs/superpowers/specs/2026-05-05-insforge-config-toml-design.md`
- Implementation plan: `docs/superpowers/plans/2026-05-05-insforge-config-toml.md`
