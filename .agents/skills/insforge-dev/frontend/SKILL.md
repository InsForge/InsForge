---
name: frontend
description: Use this skill when contributing to InsForge's frontend dashboard package. This is for maintainers editing dashboard routes, features, hooks, client-side services, contexts, and tests in the InsForge monorepo.
---

# InsForge Dev Frontend

Use this skill for `frontend/` work in the InsForge repository.

## Scope

- `frontend/src/features/**`
- `frontend/src/lib/**`
- `frontend/src/components/**`
- `frontend/src/App.tsx`
- `frontend/src/main.tsx`

## Working Rules

1. Stay feature-local when possible.
   - This frontend is built with React and TypeScript.
   - Put domain code under `frontend/src/features/<domain>/`.
   - Keep services, hooks, pages, and components near the feature they support.

2. Preserve frontend data-flow conventions.
   - Follow the flow `service -> hook -> UI`.
   - Use `apiClient` for HTTP calls so auth refresh and error handling stay consistent.
   - Put request logic in services, data fetching and mutation state in hooks, and rendering/orchestration in UI components and pages.
   - Reuse existing contexts and hooks before creating new global state.

3. Reuse the existing component layers.
   - Use `@insforge/ui` for generic primitives.
   - Use shared dashboard components when the pattern is already present.
   - Try to reuse existing components before building new ones again.
   - Only create dashboard-local components when the UI is specific to this app.
   - Prefer design tokens and existing theme-aware styles over inline styling.
   - Implement UI changes for both light and dark themes.

4. Keep frontend aligned with shared contracts.
   - Import cross-package types and Zod-derived shapes from `@insforge/shared-schemas`.
   - When backend payloads change, update the related services, hooks, and UI together.
   - Never use the TypeScript `any` type. Prefer precise prop, state, API, and hook result types.
   - Follow React best practices for composition, state ownership, side effects, and rendering.

## Validation

- `cd frontend && npm test`
- `cd frontend && npm run build`

For shared contract changes, also validate `shared-schemas/` and the affected backend surface.
