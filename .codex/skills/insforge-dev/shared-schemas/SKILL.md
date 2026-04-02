---
name: shared-schemas
description: Use this skill when contributing to InsForge's shared schema package. This is for maintainers editing published Zod contracts, exported types, and shared API payload definitions consumed by InsForge packages in this repo and other InsForge tooling.
---

# InsForge Dev Shared Schemas

Use this skill for `packages/shared-schemas/` work in the InsForge repository.

## Scope

- `packages/shared-schemas/src/**`
- any code in this repo that consumes the changed contracts
- downstream InsForge tooling that depends on the published `@insforge/shared-schemas` package, including consumers not present in this repository

## Working Rules

1. Treat `packages/shared-schemas/` as the source of truth for cross-package payloads.
   - If a request, response, or domain shape is shared across InsForge surfaces, define it here.
   - Do not duplicate the same contract in package-local files.
   - Remember that this package is not only for the repo's backend and dashboard packages. It is also consumed by other InsForge tooling, including MCP and SDK code that may live outside this repository.

2. Keep schemas organized by domain.
   - Follow the existing `*.schema.ts` and `*-api.schema.ts` split when it fits the current package pattern.
   - Keep `packages/shared-schemas/src/index.ts` aligned with the intended public API.
   - Treat exported names and schema shapes as a public contract surface, not just an internal refactor target.

3. Use schema changes as a synchronization trigger.
   - Update backend validation and response usage.
   - Update shared dashboard services, hooks, and UI assumptions in `packages/dashboard/`.
   - Check for import sites across `packages/*`, `frontend/`, and `backend/` before finishing.
   - Call out likely downstream impact on MCP, SDK, or other external InsForge consumers when a change alters exported names, schema semantics, or payload shape.
   - Be conservative with breaking changes. If a breaking contract change is necessary, make it explicit in the handoff.
   - Never use the TypeScript `any` type. Shared contracts should stay explicit and trustworthy across package boundaries.

## Validation

- `cd packages/shared-schemas && npm run build`
- `cd backend && npx tsc --noEmit`
- `cd packages/dashboard && npm run typecheck`

Run package-specific tests as needed where behavior changed.
If external consumers such as MCP or SDK cannot be validated from this repo, say that clearly instead of implying they were covered.
