# Realtime Role SQL Injection Fix

## Summary

This change hardens realtime role switching by validating the database role against a strict allowlist before executing `SET LOCAL ROLE`.

## Problem

The realtime authorization and message publishing services previously built this SQL dynamically:

```ts
await client.query(`SET LOCAL ROLE ${role}`);
```

That pattern is unsafe because it interpolates a runtime value directly into SQL.

## Why this matters

`SET LOCAL ROLE` expects a SQL identifier, not a normal value placeholder. That means the usual `$1` parameter binding pattern is not applicable here.

Because of that, the safe approach is:

1. Validate the role at runtime.
2. Allow only known database roles.
3. Use the validated value in the SQL statement.

## Fix

A shared helper now enforces an allowlist of supported database roles:

- `anon`
- `authenticated`
- `project_admin`

Both realtime services now call that helper before executing `SET LOCAL ROLE`.

## Files changed

- `backend/src/utils/database-role.ts`
- `backend/src/services/realtime/realtime-auth.service.ts`
- `backend/src/services/realtime/realtime-message.service.ts`

## Security outcome

This removes the SQL injection risk from realtime role switching while preserving the intended RLS-based authorization behavior.
