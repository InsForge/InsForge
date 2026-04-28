---
name: backend
description: Use this skill when contributing to InsForge's backend package. This is for maintainers editing backend routes, services, providers, auth, database logic (including RLS-enforced surfaces like storage and realtime), schedules, or backend tests in the InsForge monorepo.
---

# InsForge Dev Backend

Use this skill for `backend/` work in the InsForge repository.

## Scope

- `backend/src/api/**`
- `backend/src/services/**`
- `backend/src/providers/**`
- `backend/src/infra/**`
- `backend/tests/**`

## Working Rules

1. Keep the route -> service -> provider/infra split intact.
   - Routes handle auth, parsing, validation, and delegation.
   - Services own business logic and orchestration.
   - Providers and infra wrap external systems or lower-level integrations.
   - Service layer code should be the only layer that interacts with the core PostgreSQL database.
   - Do not put direct database access in routes.
   - Do not bypass services when reading from or writing to Postgres.

2. Follow backend conventions.
   - Use ESM-style `.js` import specifiers in TypeScript source.
   - InsForge's core database is PostgreSQL.
   - InsForge currently runs as a single-instance server, so be careful about introducing logic that assumes distributed coordination, cross-instance locking, or background worker separation.
   - Reuse shared schemas from `@insforge/shared-schemas` when contracts cross packages.
   - Use `safeParse` plus `AppError` for invalid input.
   - Return successful results through `successResponse`.
   - Preserve existing auth middleware patterns such as `verifyAdmin`, `verifyUser`, and `verifyApiKey`.
   - Never use the TypeScript `any` type. Prefer precise interfaces, schema-derived types, `unknown`, or constrained generics.
   - For schema changes, write a new migration file instead of editing database structure manually.
   - Put schema changes under `backend/src/infra/database/migrations/`.

3. Write idempotent migrations. Every SQL migration must be safe to re-run.
   - Use `CREATE TABLE IF NOT EXISTS`, `CREATE INDEX IF NOT EXISTS`, `ADD COLUMN IF NOT EXISTS`.
   - Never use bare `ALTER TABLE ... RENAME TO` — it fails if the target name already exists. Wrap renames in a `DO` block that checks `information_schema.tables` for both source and target.
   - Always `DROP TRIGGER IF EXISTS` before `CREATE TRIGGER`.
   - Guard data migrations and `DROP COLUMN` behind `information_schema.columns` checks when the column may already be gone.
   - Use `ON CONFLICT` or `WHERE NOT EXISTS` for seed `INSERT` statements.

4. Preserve existing behavior around mutation flows.
   - Keep audit logging when surrounding routes already log state changes.
   - Keep error handling flowing through shared middleware.
   - Do not introduce a new response envelope unless the existing feature already uses one.
   - For critical flows with multiple dependent database writes, use an explicit transactional process so the whole operation succeeds or fails together.
   - Be especially careful with transactions around auth, secrets, billing-like usage updates, schema changes, and any flow that would leave the system inconsistent if partially applied.

5. Use Postgres Row Level Security, not app-side filters, for any table that holds per-user data. Existing surfaces using this pattern: `storage.objects`, realtime channels. Do not write `WHERE user_id = $1` filters in services; let RLS evaluate `auth.jwt() ->> 'sub'` against the row.
   - Plumb identity through `withUserContext(pool, ctx, fn)` from `services/db/user-context.service.ts`. It opens a transaction, sets `SET LOCAL ROLE` plus `request.jwt.claims` via `set_config`, runs `fn`, commits, and resets role on `finally` so policies see the calling user via `auth.jwt() ->> 'sub'`.
   - Build the `UserContext` from request state. Admin callers (API key, `project_admin`) get `{ isAdmin: true }` and bypass RLS via the elevated postgres role. End users get `{ userId, role: 'authenticated', email }`. Anonymous users get `{ role: 'anon' }`.
   - Routes that issue out-of-band URLs (S3 presigned redirects, signed download links, anything the client redeems against a service that won't re-evaluate RLS) must do an explicit RLS-scoped existence check before handing the URL out — RLS does not fire when the client redeems the URL directly. See `StorageService.objectIsVisible` as the template.
   - Migrations that enable RLS on an existing populated table must auto-install a sensible default policy set so the upgrade does not silently break existing rows. See migration 036's `IF EXISTS (SELECT 1 FROM <table>) THEN <create policies> END IF` pattern.
   - When adding a new RLS-enforced table: enable RLS, `GRANT` table-level CRUD to `authenticated`, and write per-operation policies (SELECT, INSERT, UPDATE, DELETE). Public-bucket-style anonymous bypasses live at the route layer (build `ctx` with `isAdmin: true`), not in policies.

6. Always write unit tests for new code.
   - Every new feature, migration, service, or bug fix should have accompanying unit tests.
   - For migrations, write tests that validate SQL structure and idempotency guards (see `tests/unit/redirect-url-whitelist-migration.test.ts` for the pattern).
   - For services, test business logic and error cases.
   - For RLS-gated services, mock the pool/client and pin the SQL sequence (see `tests/unit/user-context.service.test.ts` and `tests/unit/storage-object-is-visible.test.ts`).
   - Run the full test suite before submitting work: `cd backend && npm test`.

## Validation

- `cd backend && npm test`
- `cd backend && npm run build`

For contract changes, also validate `packages/shared-schemas/` and any affected dashboard consumers.
