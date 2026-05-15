# InsForge Error Codes

## Ownership

Canonical API error codes live in `@insforge/shared-schemas` and are exported from the package root.

Import them like this:

```ts
import { ERROR_CODES, type ErrorCode } from '@insforge/shared-schemas';
```

The backend may keep a thin compatibility wrapper for local imports, but it should not define its own canonical error-code list.

## Naming Rules

- Use `ALL_CAPS` string values.
- Keep public string values stable once released.
- Prefer domain prefixes when the distinction helps downstream handling, for example `SCHEDULE_INVALID_CRON` or `SECRET_NOT_FOUND`.
- Use generic codes like `INVALID_INPUT` only when the error is truly cross-cutting.

## Adding A Code

1. Add the code to `packages/shared-schemas/src/error-codes.ts`.
2. Export it through `packages/shared-schemas/src/index.ts`.
3. Update backend or tooling call sites to use the shared constant instead of a raw string.
4. Add or update a test that locks the string value.

## When To Specialize

Create a domain-specific code when callers need to distinguish the failure for UX, retry logic, alerting, or CLI/MCP handling.

Good candidates are not-found, already-exists, quota, and validation failures in feature areas such as compute, deployments, schedules, payments, secrets, and provider integrations.