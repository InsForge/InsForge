---
name: ui
description: Use this skill when contributing to InsForge's reusable UI package. This is for maintainers editing design-system primitives, exports, styles, and package-level component behavior in the InsForge monorepo.
---

# InsForge Dev UI

Use this skill for `packages/ui/` work in the InsForge repository.

## Scope

- `packages/ui/src/components/**`
- `packages/ui/src/lib/**`
- `packages/ui/src/index.ts`
- `packages/ui/src/styles.css`

## Working Rules

1. Put only reusable primitives here.
   - If the component is generic across dashboard features or other InsForge apps, it belongs in `packages/ui/`.
   - If it is tightly coupled to one dashboard workflow but should ship to both OSS and cloud hosts, keep it in `packages/dashboard/`.
   - If it is only for the self-hosting host app, keep it in `frontend/`.

2. Preserve the package's implementation style.
   - Use `class-variance-authority` for variants when appropriate.
   - Use the shared `cn()` helper for class merging.
   - Follow the existing Radix-wrapper and typed-export patterns.

3. Keep the public surface in sync.
   - Export new public components from `packages/ui/src/index.ts`.
   - Avoid adding internal-only abstractions to the package surface unless they are meant to be consumed.
   - Never use the TypeScript `any` type. Keep component props and exported helpers strictly typed.

4. Validate downstream impact.
   - The shared dashboard package consumes this package directly, so UI changes can break `packages/dashboard/` even if `packages/ui/` itself builds cleanly.

## Validation

- `cd packages/ui && npm run build`
- `cd packages/ui && npm run typecheck`

Also validate `packages/dashboard/` when the changed component is used in the dashboard, and validate `frontend/` if the host app integration or CSS entrypoints changed.
