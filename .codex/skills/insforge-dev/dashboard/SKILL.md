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

**Use when** previewing UI gated on `useIsCloudHostingMode()`, `isInsForgeCloudProject()`, or a PostHog feature flag (e.g. the CTest dashboard variant, `dashboard-v3-experiment === 'c_test'`, the CLI connect panel) while running the local `frontend/` self-hosting shell.

The lowest-friction approach is to **temporarily hardcode** the three gates below to `true`/the new branch, then restart the Vite dev server. These edits bypass real host/project detection and MUST be fully reverted before committing — landing them breaks both self-hosting and cloud-hosting users.

### Hardcodes

1. `packages/dashboard/src/lib/config/DashboardHostContext.tsx` — `useIsCloudHostingMode()` → `return true;` (was `useDashboardHost().mode === 'cloud-hosting'`).
2. `packages/dashboard/src/lib/utils/utils.ts` — `isInsForgeCloudProject()` → `return true;` (was the `.insforge.app` hostname check).
3. If the UI is also feature-flag-gated, hardcode the consumer. For CTest: `AppRoutes.tsx` → `const DashboardHomePage = CTestDashboardPage;` and, if relevant, the matching branch in `AppLayout.tsx` for `<ConnectDialogV2>`.

Mark every hardcode with a trailing `// LOCAL DEBUG: <original expression>` comment so revert is a mechanical search.

### Revert checklist — run all before committing

1. `git grep -n "LOCAL DEBUG" packages/dashboard/src/` returns zero matches.
2. Each gate is restored to its **original expression**, not just an equivalent value (the `mode === 'cloud-hosting'` comparison, the hostname check, the `getFeatureFlag(...)` call must all be back).
3. Any imports deleted during debug (commonly `DashboardPage`, `getFeatureFlag`, `ConnectDialog`) are restored.
4. `cd packages/dashboard && npm run lint && npm run typecheck` both pass.
5. `git diff` of the four files above shows only intended changes — no `return true;`, no missing imports.

### Rationalizations to reject

| Excuse | Reality |
|--------|---------|
| "I'll revert in a follow-up PR." | Follow-up = a window where prod is broken. Revert now. |
| "The original check was effectively the same." | If it were, you wouldn't have needed the hardcode. Restore the expression, not a value-equivalent. |
| "Lint passed, so the deleted import doesn't matter." | Lint passed because the import was deleted; on revert the original code needs it back. |
| "I'll ship the env-var override instead." | No env-var override is wired in the code. Don't invent one on the commit path — restore the original. |

## Validation

- `cd packages/dashboard && npm run typecheck`
- `cd packages/dashboard && npm run build`
- `cd frontend && npm run build` when the local self-hosting shell changes

For shared contract changes, also validate `packages/shared-schemas/` and the affected backend surface.
