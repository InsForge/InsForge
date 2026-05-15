---
title: "CLI Telemetry"
description: "What the InsForge CLI sends to PostHog, why, and how to turn it off."
---

The InsForge CLI (`@insforge/cli`) reports anonymous usage events to [PostHog](https://posthog.com). The goal is straightforward: we want to know which commands users actually run so we can prioritize where to invest. This page documents exactly what gets sent and how to opt out.

## What we collect

Each captured event carries a small, fixed set of properties. The exact shape depends on the command, but the categories are always the same.

**Command identity**

- Event name (e.g. `cli_config_invoked`, `cli_diagnose_invoked`, `cli_payments_invoked`).
- `subcommand`: which subcommand ran (e.g. `apply`, `plan`, `export`, `status`).
- `outcome`: the result tag (`success`, `applied`, `aborted`, `dry_run`, `no_changes`, `error`, ...).

**Run shape**

- Flag booleans like `dry_run`, `json_mode`, `auto_approved`, `force`.
- Counts like `changes_count`, `applied_count`, `skipped_count`. No data, just integers.
- For `config apply` / `config plan`: a list of `sections_changed` containing TOML schema keys (e.g. `auth.smtp`, `auth.password.min_length`, `deployments.subdomain`). These are schema enum values, not your configuration values.

**Project metadata** (when you are logged in)

- `project_id`, `project_name`, `org_id`, `region`.
- `oss_mode`: a boolean indicating whether the run targeted an OSS deployment (no cloud project linked) or a managed InsForge Cloud project.

## What we do not collect

We do not capture:

- SQL queries or query results.
- Contents of your `insforge.toml` (only the *names* of schema sections that changed).
- File paths, file contents, or any data from your repository.
- Credentials, tokens, secrets, SMTP passwords, OAuth client secrets, or any value resolved from `env()` references.
- Free text that you typed into prompts.
- Environment variable values.

The full property allowlist is defined in [`src/lib/analytics.ts`](https://github.com/InsForge/CLI/blob/main/src/lib/analytics.ts) and reviewed in code review for every new event helper.

## How to turn it off

Set `INSFORGE_TELEMETRY=0` in your shell or CI environment:

```bash
export INSFORGE_TELEMETRY=0
```

The variable also accepts `false` and `no` (case-insensitive). With the variable set, the CLI never constructs the PostHog client and never opens a network connection for analytics. There is no graceful degradation to worry about and no "but it still pings home for X" caveat. The opt-out is a hard early return.

To make the opt-out permanent for your environment, add the export to your shell profile (`~/.zshrc`, `~/.bashrc`, etc.) or your CI's secret/variable configuration.

## Building from source

If you build the CLI from source without the build-time `POSTHOG_API_KEY` environment variable, analytics become a no-op automatically. Forks and local development builds never report telemetry unless the maintainer explicitly injects a key.

## Where the data lives

Events flow to the **InsForge Prod** project on PostHog Cloud (US region). The CLI maintainers use the data exclusively to inform product decisions; we do not share it with third parties and we do not use it for advertising.

For broader privacy questions, see the InsForge privacy policy at [insforge.dev](https://insforge.dev).
