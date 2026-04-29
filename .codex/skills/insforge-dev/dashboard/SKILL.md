---
name: dashboard
description: Use this skill when contributing to InsForge's shared dashboard package. This is for maintainers editing `packages/dashboard`, which ships in `self-hosting` and `cloud-hosting` modes, and the local `frontend/` shell used for `self-hosting` in this repo.
---

# InsForge Dev Dashboard

Use this skill for dashboard work in the InsForge repository.

## Scope

- `packages/dashboard/src/**`
- `packages/dashboard/package.json`
- `packages/dashboard/README.md`
- `packages/dashboard/*.config.*`
- `frontend/src/**`
- `frontend/package.json`

## Working Rules

1. Respect the shared-package versus host-app boundary.
   - This dashboard is built with React and TypeScript.
   - `packages/dashboard/` is the source of truth for the dashboard product.
   - The package must support both `self-hosting` and `cloud-hosting` modes.
   - Keep self-hosting-only bootstrap, local env defaults, and shell styling in `frontend/`.
   - Do not let `packages/dashboard/` depend on `frontend/`.
   - If both modes need a capability, define it in the package API first.

2. Preserve dashboard data-flow conventions.
   - Follow the flow `service -> hook -> UI`.
   - Use `apiClient` for HTTP calls so auth refresh and error handling stay consistent.
   - Put request logic in services, data fetching and mutation state in hooks, and rendering/orchestration in UI components and pages.
   - Reuse existing contexts, host abstractions, and hooks before creating new global state.

3. Reuse the existing component layers.
   - Use `@insforge/ui` for generic primitives.
   - Use shared dashboard components when the pattern is already present.
   - Keep reusable dashboard UI in `packages/dashboard/`.
   - Only add UI to `frontend/` when it is specific to the local self-hosting shell.
   - Keep package styles scoped to the dashboard container.

4. Keep the package surface aligned with shared contracts.
   - Import cross-package types and Zod-derived shapes from `@insforge/shared-schemas`.
   - When backend payloads change, update the related services, hooks, UI, and exported types together.
   - Keep `packages/dashboard/src/index.ts` and `packages/dashboard/src/types` aligned with the public package API.
   - Never use the TypeScript `any` type. Prefer precise prop, state, API, and hook result types.

## Local debug: viewing cloud-hosting-only UI in self-hosting

Run the frontend dev server with `VITE_MOCK_CLOUD=true` to activate the fake cloud shell — no file edits, no revert checklist.

```bash
VITE_MOCK_CLOUD=true npm run dev --workspace=frontend
```

The app renders with a fake cloud navbar on top (with a "MOCK" badge), a hardcoded fake project, all `isCloud` gates true, and cloud-only data pages (Deployments / Backup / Instance) in empty state. Stop and restart the dev server without the flag to return to normal self-hosting.

Known gap: code paths that depend on postMessage from a real cloud parent do not execute in mock mode.

## Validation

- `cd packages/dashboard && npm run typecheck`
- `cd packages/dashboard && npm run build`
- `cd frontend && npm run build` when the local self-hosting shell changes

For shared contract changes, also validate `packages/shared-schemas/` and the affected backend surface.
