---
description: Contributor guidance for the InsForge OSS monorepo
globs: *
alwaysApply: true
---

# InsForge Monorepo Contributor Guide

These instructions apply to work inside the `InsForge/InsForge` repository. They are for contributors and automated assistants maintaining the OSS monorepo, not for developers scaffolding a consumer application with the InsForge SDK or MCP tools.

## Repository Scope

- `backend/` contains the Express backend, PostgreSQL integrations, migrations, services, routes, and backend tests.
- `frontend/` is the self-hosting dashboard host app.
- `packages/dashboard/` contains the shared dashboard package used by hosting surfaces.
- `packages/ui/` contains shared React UI components and design-system assets.
- `packages/shared-schemas/` contains shared Zod schemas and TypeScript types.
- `docs/` contains documentation for InsForge features and MCP usage.
- `functions/` contains serverless function examples and related assets.

Keep SDK or app-builder instructions scoped to docs, examples, templates, or README sections that are explicitly about using InsForge from an application. Do not put consumer project scaffolding steps in this root contributor file.

## Working Guidelines

- Start from the issue or PR context and keep changes focused on that scope.
- Prefer existing package patterns, naming, route structure, services, hooks, and test helpers.
- Keep shared contracts in `packages/shared-schemas` when backend and frontend both depend on a shape.
- Add or update tests when behavior changes. For documentation-only changes, validate formatting and links where practical.
- Avoid unrelated refactors, generated churn, or lockfile updates unless the change requires them.
- For database migrations, use the existing migration structure under `backend/src/infra/database/migrations` and run the duplicate-number check.
- For UI work, prefer components from `packages/ui` and existing dashboard patterns before adding new primitives.

## Common Commands

Install dependencies from the repo root:

```bash
npm install
```

Run the full workspace checks:

```bash
npm test
npm run lint
npm run typecheck
npm run format:check
```

Run backend-only checks:

```bash
npm run test:backend
cd backend && npm run typecheck
cd backend && npm run lint
```

Run end-to-end tests when the change touches workflows covered by Dockerized integration tests:

```bash
npm run test:e2e
```

Check migration numbering when adding or editing migrations:

```bash
cd backend && npm run migrate:check-duplicates
```

## Pull Requests

- Use a focused branch name such as `docs/rescope-agents-md`, `fix/auth-refresh-session`, or `feat/storage-policy`.
- Link the issue in the PR body when applicable.
- Summarize the user-visible change, implementation notes, and validation commands.
- Keep maintainer edits enabled for fork PRs.
- If a check cannot be run locally, state the blocker clearly in the PR body or follow-up comment.
