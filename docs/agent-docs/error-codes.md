# InsForge Error Codes

## Ownership

Canonical API error codes live in `@insforge/shared-schemas` and are exported from the package root.

Import them like this:

```ts
import { ERROR_CODES, errorCodeSchema, type ErrorCode } from '@insforge/shared-schemas';
```

Backend code should use `ERROR_CODES.X`; runtime validation code should use `errorCodeSchema`. Do not define a backend-local canonical error-code list.

## Naming Rules

- Use `ALL_CAPS` string values.
- Keep public string values stable once released.
- Prefer domain prefixes when the distinction helps downstream handling, for example `SCHEDULE_INVALID_CRON` or `SECRET_NOT_FOUND`.
- Use generic codes like `INVALID_INPUT` only when the error is truly cross-cutting.

## Adding A Code

1. Add the string literal to the relevant list that feeds `errorCodeSchema` in `packages/shared-schemas/src/error-codes.schema.ts`.
2. Export it from the package root in `packages/shared-schemas/src/index.ts` using `export * from "./error-codes.schema.js";`.
3. Update backend or tooling call sites to use the shared constant instead of a raw string.
4. Add or update a test that locks the string value.

## Error Codes vs. Next Actions

While canonical error codes are shared globally through `errorCodeSchema`, `NEXT_ACTIONS` guidance constants and templates must remain **backend-local** (defined in `backend/src/utils/next-actions.ts`) instead of being exported from `@insforge/shared-schemas`.

### Rationale

- **Stable Contract vs. Guidance Hints:** Error codes serve as the stable cross-package contract that SDKs, CLIs, tooling, and frontends need to programmatically match on. `nextAction`s, conversely, represent dynamic backend response hints and user-facing guidance.
- **Contract Surface Reduction:** External consumers can read the concrete string values from the response payload without needing a shared, strongly typed export. Keeping `NEXT_ACTIONS` out of `shared-schemas` prevents expanding the public contract surface unnecessarily.
- **Maintainability:** Keeping these messaging hints backend-local allows the backend team to evolve, update, and refactor user guidance strings dynamically without needing to coordinate library releases across the SDK, CLI, or frontend.

## When To Specialize

Create a domain-specific code when callers need to distinguish the failure for UX, retry logic, alerting, or CLI/MCP handling.

Good candidates are not-found, already-exists, quota, and validation failures in feature areas such as compute, deployments, schedules, payments, secrets, and provider integrations.
