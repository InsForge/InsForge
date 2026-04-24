---
name: insforge-dev
description: Use this skill set when contributing to the InsForge monorepo itself. This is for InsForge maintainers and contributors editing the platform, the shared dashboard package, the self-hosting shell, the UI library, shared schemas, tests, or docs.
---

# InsForge Dev

Use this skill set for work inside the InsForge repository.

Then use the narrowest package skill that matches the task:

- `backend`
- `dashboard`
- `ui`
- `shared-schemas`
- `docs`

## Core Rules

1. Identify the package boundary before editing.
   - `backend/`: API, auth, database, providers, realtime, schedules
   - `packages/dashboard/`: publishable dashboard package that supports `self-hosting` and `cloud-hosting` modes
   - `frontend/`: local React + Vite shell that mounts `packages/dashboard/` in `self-hosting` mode
   - `packages/shared-schemas/`: cross-package contracts
   - `packages/ui/`: reusable design-system primitives
   - `docs/`: product and agent-facing documentation

2. Put code in the narrowest correct layer.
   - Contract change: `packages/shared-schemas/` first, then consumers.
   - Backend behavior: route -> service -> provider/infra.
   - Shared dashboard behavior, routes, features, exports, and host contracts: `packages/dashboard/`.
   - Self-hosting-only bootstrap, env wiring, and shell styling: `frontend/`.
   - Reusable primitive: `packages/ui/` first.

3. Preserve repo conventions.
   - Backend TS source uses ESM-style `.js` import specifiers.
   - Backend success responses usually return raw JSON, not `{ data }`.
   - Backend validation commonly uses shared Zod schemas plus `AppError`.
   - Dashboard data access goes through `apiClient` and React Query.
   - Shared payloads belong in `@insforge/shared-schemas`.
   - Never use the TypeScript `any` type. Prefer precise types, schema-derived types, `unknown`, or generics.

4. Do not confuse repo development with app development on InsForge.
   - This repo contains the platform, the publishable dashboard package, and a local shell for self-hosting mode.
   - Keep guidance focused on maintaining InsForge itself.

## Finish Rules

- Run the smallest validation that gives confidence for the change.
- Use repo-level checks like `npm run lint`, `npm run build`, and `npm test` when the change crosses package boundaries.
- `npm run typecheck` does not cover `packages/dashboard/` or `packages/shared-schemas/`, so run package-specific validation when either package changes.
- Use the package-specific validation steps in the child skill when the work is isolated to one package.
- When reporting back, state what changed, what you validated, and what you could not validate.

## Pre-PR Checklist (Mandatory Before Pushing to a PR)

Before opening a PR or pushing new commits to an existing PR branch, run **all** of the following from the repo root and do not proceed while any of them fail on files your change touches:

1. `npx turbo run typecheck` — must pass across all packages.
2. `npx turbo run lint` — must pass. If the failure is pre-existing in `main` and unrelated to your change, scope it:
   - Run `npx eslint <your-changed-files>` and confirm your files are clean.
   - Call out the pre-existing debt in the PR body so reviewers know it is not yours.
   - Auto-fixable prettier/eslint errors in your own diff must be fixed (`npx eslint --fix <file>` or `npm run format`).
3. `npx turbo run test` (or the package-specific test command) — all tests must pass, including any new tests you added for the change.
4. `npx turbo run build` if routing, config, schemas, or cross-package exports changed.

Never push with failing checks on files you touched, even if CI would catch them later. CI failures slow reviewers down and the lint fix almost always takes less than a minute locally.
