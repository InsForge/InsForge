---
name: ui
description: Use this skill when contributing to InsForge's reusable UI package. This is for maintainers editing design-system primitives, exports, styles, and package-level component behavior in the InsForge monorepo.
---

# InsForge Dev UI

Use this skill for `ui/` package work in the InsForge repository.

## Scope

- `ui/src/components/**`
- `ui/src/lib/**`
- `ui/src/index.ts`
- `ui/src/styles.css`

## Working Rules

1. Put only reusable primitives here.
   - If the component is generic across dashboard features, it belongs in `ui/`.
   - If it is tightly coupled to one dashboard workflow, keep it in `frontend/`.

2. Preserve the package's implementation style.
   - Use `class-variance-authority` for variants when appropriate.
   - Use the shared `cn()` helper for class merging.
   - Follow the existing Radix-wrapper and typed-export patterns.

3. Keep the public surface in sync.
   - Export new public components from `ui/src/index.ts`.
   - Avoid adding internal-only abstractions to the package surface unless they are meant to be consumed.
   - Never use the TypeScript `any` type. Keep component props and exported helpers strictly typed.

4. Validate downstream impact.
   - The dashboard consumes this package directly during development, so UI changes can break `frontend/` even if `ui/` itself builds cleanly.

## Validation

- `cd ui && npm run build`
- `cd ui && npm run typecheck`

Also validate `frontend/` when the changed component is used in the dashboard.
