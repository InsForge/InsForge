---
name: insforge-dev
description: Use this skill set when contributing to the InsForge monorepo itself. This is for InsForge maintainers and contributors editing the platform, dashboard, UI library, shared schemas, tests, or docs.
---

# InsForge Dev

Use this skill set for work inside the InsForge repository.

Then use the narrowest package skill that matches the task:

- `backend`
- `frontend`
- `ui`
- `shared-schemas`
- `docs`

## Core Rules

1. Identify the package boundary before editing.
   - `backend/`: API, auth, database, providers, realtime, schedules
   - `frontend/`: internal dashboard and feature flows
   - `shared-schemas/`: cross-package contracts
   - `ui/`: reusable design-system primitives
   - `docs/`: product and agent-facing documentation

2. Put code in the narrowest correct layer.
   - Contract change: `shared-schemas/` first, then consumers.
   - Backend behavior: route -> service -> provider/infra.
   - Frontend behavior: feature service -> hook -> page/component.
   - Reusable primitive: `ui/` first.

3. Preserve repo conventions.
   - Backend TS source uses ESM-style `.js` import specifiers.
   - Backend success responses usually return raw JSON, not `{ data }`.
   - Backend validation commonly uses shared Zod schemas plus `AppError`.
   - Frontend data access goes through `apiClient` and React Query.
   - Shared payloads belong in `@insforge/shared-schemas`.
   - Never use the TypeScript `any` type. Prefer precise types, schema-derived types, `unknown`, or generics.

4. Do not confuse repo development with app development on InsForge.
   - This repo contains the platform and dashboard.
   - Keep guidance focused on maintaining InsForge itself.

## Finish Rules

- Run the smallest validation that gives confidence for the change.
- Use repo-level checks like `npm run lint`, `npm run typecheck`, `npm run build`, and `npm test` when the change crosses package boundaries.
- Use the package-specific validation steps in the child skill when the work is isolated to one package.
- When reporting back, state what changed, what you validated, and what you could not validate.
