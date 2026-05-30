# Custom Database Migrations Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add developer-facing database migrations that execute immediately against the `public` schema and record only successful runs in `system.custom_migrations`.

**Architecture:** The backend owns the migration workflow through a dedicated service and admin routes under `/api/database/migrations`. The service parses and validates SQL, runs it inside a single transaction with a transaction-scoped advisory lock, and inserts a history row into `system.custom_migrations` only after the SQL succeeds. Shared schemas define the request/response contract, and the dashboard consumes that contract through a `service -> hook -> UI` flow with a new read-only Database Studio page.

**Tech Stack:** PostgreSQL 15, Express, TypeScript, Zod, React, React Query, CodeMirror, Vitest

---

## File Map

| Path | Responsibility |
| --- | --- |
| `backend/src/infra/database/migrations/032_create-custom-migrations.sql` | Create `system.custom_migrations` with the minimal applied-history shape |
| `backend/tests/unit/custom-migrations-table-migration.test.ts` | Validate SQL migration structure and idempotency guards |
| `backend/src/services/database/database-migration.service.ts` | List migrations and run new migrations transactionally |
| `backend/tests/unit/database-migration.service.test.ts` | Service-level validation and transactional behavior |
| `backend/src/api/routes/database/migrations.routes.ts` | Admin routes for list/create |
| `backend/src/api/routes/database/index.routes.ts` | Mount new migrations router |
| `backend/src/utils/sql-parser.ts` | Reuse or extend helpers for schema restrictions and socket invalidation |
| `packages/shared-schemas/src/database.schema.ts` | `migrationSchema` domain shape |
| `packages/shared-schemas/src/database-api.schema.ts` | Request/response schemas for migrations API |
| `packages/shared-schemas/src/index.ts` | Export shared migration contracts |
| `packages/dashboard/src/features/database/services/migration.service.ts` | Dashboard API client for migrations |
| `packages/dashboard/src/features/database/hooks/useMigrations.ts` | React Query hooks for list/create |
| `packages/dashboard/src/features/database/components/DatabaseSidebar.tsx` | Add `Migrations` to the Database Studio sidebar |
| `packages/dashboard/src/features/database/components/MigrationFormDialog.tsx` | Run-migration dialog with SQL editor |
| `packages/dashboard/src/features/database/pages/MigrationsPage.tsx` | Read-only migration history page |
| `packages/dashboard/src/router/AppRoutes.tsx` | Register `/dashboard/database/migrations` |

### Task 1: Create the Applied-Migrations Table

**Files:**
- Create: `backend/src/infra/database/migrations/032_create-custom-migrations.sql`
- Test: `backend/tests/unit/custom-migrations-table-migration.test.ts`

- [ ] **Step 1: Write the failing migration SQL test**

```ts
import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const currentDir = path.dirname(fileURLToPath(import.meta.url));
const migrationPath = path.resolve(
  currentDir,
  '../../src/infra/database/migrations/032_create-custom-migrations.sql'
);

describe('032_create-custom-migrations migration', () => {
  const sql = fs.readFileSync(migrationPath, 'utf8');

  it('creates system.custom_migrations with the expected columns', () => {
    expect(sql).toMatch(/CREATE TABLE IF NOT EXISTS system\.custom_migrations/i);
    expect(sql).toMatch(/sequence_number INTEGER PRIMARY KEY/i);
    expect(sql).toMatch(/name TEXT NOT NULL UNIQUE/i);
    expect(sql).toMatch(/statements TEXT\[\] NOT NULL/i);
    expect(sql).toMatch(/created_at TIMESTAMPTZ NOT NULL DEFAULT now\(\)/i);
  });

  it('does not expose a surrogate id column', () => {
    expect(sql).not.toMatch(/\bid\b/i);
  });
});
```

- [ ] **Step 2: Run the migration SQL test to verify it fails**

Run: `cd /Users/lyu/Documents/GitHub/InsForge/backend && npm test -- custom-migrations-table-migration.test.ts`
Expected: FAIL with a missing file error for `032_create-custom-migrations.sql`

- [ ] **Step 3: Write the migration SQL file**

```sql
CREATE SCHEMA IF NOT EXISTS system;

CREATE TABLE IF NOT EXISTS system.custom_migrations (
  sequence_number INTEGER PRIMARY KEY,
  name TEXT NOT NULL UNIQUE,
  statements TEXT[] NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
```

- [ ] **Step 4: Add idempotent guards for re-runs**

```sql
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM information_schema.tables
    WHERE table_schema = 'system'
      AND table_name = 'custom_migrations'
  ) THEN
    CREATE TABLE system.custom_migrations (
      sequence_number INTEGER PRIMARY KEY,
      name TEXT NOT NULL UNIQUE,
      statements TEXT[] NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );
  END IF;
END $$;
```

- [ ] **Step 5: Re-run the migration SQL test**

Run: `cd /Users/lyu/Documents/GitHub/InsForge/backend && npm test -- custom-migrations-table-migration.test.ts`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add \
  backend/src/infra/database/migrations/032_create-custom-migrations.sql \
  backend/tests/unit/custom-migrations-table-migration.test.ts
git commit -m "feat: add custom migrations history table"
```

### Task 2: Implement Backend Migration Service

**Files:**
- Create: `backend/src/services/database/database-migration.service.ts`
- Test: `backend/tests/unit/database-migration.service.test.ts`
- Modify: `backend/src/utils/sql-parser.ts`

- [ ] **Step 1: Write the failing service tests**

```ts
describe('DatabaseMigrationService.createMigration', () => {
  it('rejects statements that reference a non-public schema', async () => {
    await expect(
      service.createMigration({
        name: 'break-auth',
        sql: 'CREATE TABLE auth.test_users (id uuid);',
        actor: 'admin@example.com',
      })
    ).rejects.toThrow(/public schema/i);
  });

  it('inserts history only after SQL succeeds', async () => {
    mockClient.query
      .mockResolvedValueOnce(undefined) // BEGIN
      .mockResolvedValueOnce({ rows: [{ next_sequence_number: 1 }] })
      .mockResolvedValueOnce(undefined) // statement
      .mockResolvedValueOnce(undefined) // insert history
      .mockResolvedValueOnce(undefined); // COMMIT

    await service.createMigration({
      name: 'create-posts',
      sql: 'CREATE TABLE posts (id uuid primary key);',
      actor: 'admin@example.com',
    });

    expect(mockClient.query).toHaveBeenCalledWith(
      expect.stringMatching(/INSERT INTO system\.custom_migrations/i),
      expect.any(Array)
    );
  });
});
```

- [ ] **Step 2: Run the service tests to verify they fail**

Run: `cd /Users/lyu/Documents/GitHub/InsForge/backend && npm test -- database-migration.service.test.ts`
Expected: FAIL because `database-migration.service.ts` does not exist yet

- [ ] **Step 3: Create the service skeleton**

```ts
export class DatabaseMigrationService {
  private static instance: DatabaseMigrationService;
  private dbManager = DatabaseManager.getInstance();

  public static getInstance(): DatabaseMigrationService {
    if (!DatabaseMigrationService.instance) {
      DatabaseMigrationService.instance = new DatabaseMigrationService();
    }
    return DatabaseMigrationService.instance;
  }
}
```

- [ ] **Step 4: Implement list and create methods**

```ts
async listMigrations(): Promise<DatabaseMigrationsResponse> {
  const result = await this.dbManager.getPool().query(`
    SELECT
      sequence_number AS "sequenceNumber",
      name,
      statements,
      created_at AS "createdAt"
    FROM system.custom_migrations
    ORDER BY sequence_number DESC
  `);

  return { migrations: result.rows };
}

async createMigration(input: CreateMigrationRequest & { actor: string }): Promise<CreateMigrationResponse> {
  const statements = parseSQLStatements(input.sql);
  this.assertPublicSchemaOnly(statements);
  return this.runMigrationTransaction(input.name, statements);
}
```

- [ ] **Step 5: Enforce the public-schema-only rules**

```ts
private assertPublicSchemaOnly(statements: string[]): void {
  for (const statement of statements) {
    const parsed = statement.toLowerCase();
    if (/\b(auth|system|storage|ai|functions|realtime|schedules|pg_catalog|information_schema)\b/.test(parsed)) {
      throw new AppError(
        'Custom migrations may only target the public schema.',
        400,
        ERROR_CODES.DATABASE_FORBIDDEN
      );
    }

    if (/\b(set\s+search_path|begin\b|commit\b|rollback\b|create\s+schema|drop\s+schema)\b/.test(parsed)) {
      throw new AppError(
        'Custom migrations cannot modify schema routing or manage their own transactions.',
        400,
        ERROR_CODES.DATABASE_FORBIDDEN
      );
    }
  }
}
```

- [ ] **Step 6: Execute the migration transactionally and insert history on success**

```ts
await client.query('BEGIN');
await client.query("SELECT pg_advisory_xact_lock(hashtext('system.custom_migrations'))");
await client.query('SET LOCAL search_path TO public');

const sequenceResult = await client.query(`
  SELECT COALESCE(MAX(sequence_number), 0) + 1 AS next_sequence_number
  FROM system.custom_migrations
`);

for (const statement of statements) {
  await client.query(statement);
}

await client.query(
  `
    INSERT INTO system.custom_migrations (sequence_number, name, statements)
    VALUES ($1, $2, $3)
  `,
  [sequenceNumber, name, statements]
);

await client.query(`NOTIFY pgrst, 'reload schema';`);
await client.query('COMMIT');
```

- [ ] **Step 7: Extend the SQL change typing so migration creates invalidate the new page**

```ts
export interface DatabaseResourceUpdate {
  type: 'tables' | 'table' | 'records' | 'index' | 'trigger' | 'policy' | 'function' | 'extension' | 'migration';
  name?: string;
}
```

- [ ] **Step 8: Re-run the service tests**

Run: `cd /Users/lyu/Documents/GitHub/InsForge/backend && npm test -- database-migration.service.test.ts`
Expected: PASS

- [ ] **Step 9: Commit**

```bash
git add \
  backend/src/services/database/database-migration.service.ts \
  backend/src/utils/sql-parser.ts \
  backend/tests/unit/database-migration.service.test.ts
git commit -m "feat: add custom migration backend service"
```

### Task 3: Expose Admin Routes for Migrations

**Files:**
- Create: `backend/src/api/routes/database/migrations.routes.ts`
- Modify: `backend/src/api/routes/database/index.routes.ts`

- [ ] **Step 1: Write the failing route-level behavior test or request fixture**

```ts
it('mounts GET /api/database/migrations', async () => {
  const response = await request(app)
    .get('/api/database/migrations')
    .set('Authorization', `Bearer ${adminToken}`);

  expect(response.status).toBe(200);
});
```

- [ ] **Step 2: Create the migrations router**

```ts
const router = Router();
const migrationService = DatabaseMigrationService.getInstance();

router.get('/', verifyAdmin, async (_req, res, next) => {
  try {
    const response = await migrationService.listMigrations();
    successResponse(res, response);
  } catch (error) {
    next(error);
  }
});
```

- [ ] **Step 3: Add the create-and-run endpoint**

```ts
router.post('/', verifyAdmin, async (req: AuthRequest, res, next) => {
  try {
    const validation = createMigrationRequestSchema.safeParse(req.body);
    if (!validation.success) {
      throw new AppError('Invalid migration payload', 400, ERROR_CODES.INVALID_INPUT);
    }

    const result = await migrationService.createMigration({
      ...validation.data,
      actor: req.user?.email || 'api-key',
    });

    await auditService.log({
      actor: req.user?.email || 'api-key',
      action: 'CREATE_CUSTOM_MIGRATION',
      module: 'DATABASE',
      details: { name: validation.data.name, statementCount: result.statements.length },
      ip_address: req.ip,
    });

    successResponse(res, result, 201);
  } catch (error) {
    next(error);
  }
});
```

- [ ] **Step 4: Mount the router in the database route index**

```ts
import { databaseMigrationsRouter } from './migrations.routes.js';

router.use('/migrations', databaseMigrationsRouter);
```

- [ ] **Step 5: Run the focused backend tests**

Run: `cd /Users/lyu/Documents/GitHub/InsForge/backend && npm test -- database-migration`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add \
  backend/src/api/routes/database/migrations.routes.ts \
  backend/src/api/routes/database/index.routes.ts
git commit -m "feat: expose custom migration admin routes"
```

### Task 4: Add Shared Migration Contracts

**Files:**
- Modify: `packages/shared-schemas/src/database.schema.ts`
- Modify: `packages/shared-schemas/src/database-api.schema.ts`
- Modify: `packages/shared-schemas/src/index.ts`

- [ ] **Step 1: Add the migration domain schema**

```ts
export const migrationSchema = z.object({
  sequenceNumber: z.number().int().positive(),
  name: z.string().min(1),
  statements: z.array(z.string()).min(1),
  createdAt: z.string(),
});
```

- [ ] **Step 2: Add request/response schemas**

```ts
export const createMigrationRequestSchema = z.object({
  name: z.string().min(1, 'Migration name is required'),
  sql: z.string().min(1, 'Migration SQL is required'),
});

export const createMigrationResponseSchema = migrationSchema.extend({
  message: z.string(),
});

export const databaseMigrationsResponseSchema = z.object({
  migrations: z.array(migrationSchema),
});
```

- [ ] **Step 3: Export the new contracts**

```ts
export type Migration = z.infer<typeof migrationSchema>;
export type CreateMigrationRequest = z.infer<typeof createMigrationRequestSchema>;
export type CreateMigrationResponse = z.infer<typeof createMigrationResponseSchema>;
export type DatabaseMigrationsResponse = z.infer<typeof databaseMigrationsResponseSchema>;
```

- [ ] **Step 4: Build shared schemas**

Run: `cd /Users/lyu/Documents/GitHub/InsForge/packages/shared-schemas && npm run build`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add \
  packages/shared-schemas/src/database.schema.ts \
  packages/shared-schemas/src/database-api.schema.ts \
  packages/shared-schemas/src/index.ts
git commit -m "feat: add shared migration api contracts"
```

### Task 5: Add Dashboard Service, Hook, Route, and Sidebar Entry

**Files:**
- Create: `packages/dashboard/src/features/database/services/migration.service.ts`
- Create: `packages/dashboard/src/features/database/hooks/useMigrations.ts`
- Modify: `packages/dashboard/src/features/database/components/DatabaseSidebar.tsx`
- Modify: `packages/dashboard/src/router/AppRoutes.tsx`
- Modify: `packages/dashboard/src/lib/contexts/SocketContext.tsx`

- [ ] **Step 1: Create the dashboard migration service**

```ts
export class MigrationService {
  async listMigrations(): Promise<DatabaseMigrationsResponse> {
    return apiClient.request('/database/migrations', {
      method: 'GET',
      headers: apiClient.withAccessToken({}),
    });
  }

  async createMigration(body: CreateMigrationRequest): Promise<CreateMigrationResponse> {
    return apiClient.request('/database/migrations', {
      method: 'POST',
      headers: apiClient.withAccessToken({ 'Content-Type': 'application/json' }),
      body: JSON.stringify(body),
    });
  }
}
```

- [ ] **Step 2: Add the React Query hook**

```ts
export function useMigrations(enabled = false) {
  const queryClient = useQueryClient();
  const { showToast } = useToast();

  const query = useQuery({
    queryKey: ['database', 'migrations'],
    queryFn: () => migrationService.listMigrations(),
    enabled,
  });

  const createMutation = useMutation({
    mutationFn: (body: CreateMigrationRequest) => migrationService.createMigration(body),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['database', 'migrations'] });
      await queryClient.invalidateQueries({ queryKey: ['tables'] });
      showToast('Migration executed successfully', 'success');
    },
  });

  return { ...query, createMigration: createMutation.mutateAsync, isCreating: createMutation.isPending };
}
```

- [ ] **Step 3: Register the route and sidebar item**

```tsx
{
  id: 'migrations',
  label: 'Migrations',
  href: '/dashboard/database/migrations',
},
```

```tsx
<Route path="migrations" element={<MigrationsPage />} />
```

- [ ] **Step 4: Invalidate the migrations query on socket data updates**

```ts
case 'migration':
  void queryClient.invalidateQueries({ queryKey: ['database', 'migrations'] });
  break;
```

- [ ] **Step 5: Run dashboard typecheck**

Run: `cd /Users/lyu/Documents/GitHub/InsForge/packages/dashboard && npm run typecheck`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add \
  packages/dashboard/src/features/database/services/migration.service.ts \
  packages/dashboard/src/features/database/hooks/useMigrations.ts \
  packages/dashboard/src/features/database/components/DatabaseSidebar.tsx \
  packages/dashboard/src/router/AppRoutes.tsx \
  packages/dashboard/src/lib/contexts/SocketContext.tsx
git commit -m "feat: wire dashboard migration data flow"
```

### Task 6: Build the Migrations Page and Run Dialog

**Files:**
- Create: `packages/dashboard/src/features/database/pages/MigrationsPage.tsx`
- Create: `packages/dashboard/src/features/database/components/MigrationFormDialog.tsx`
- Reuse: `packages/dashboard/src/features/database/components/SQLModal.tsx`
- Reuse: `packages/dashboard/src/components/CodeEditor.tsx`

- [ ] **Step 1: Create the migration run dialog**

```tsx
export function MigrationFormDialog({ open, onOpenChange, onSubmit, isSubmitting }: Props) {
  const [name, setName] = useState('');
  const [sql, setSql] = useState('');

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-3xl">
        <DialogHeader>
          <DialogTitle>Run Migration</DialogTitle>
          <DialogDescription>
            This runs immediately against the public schema and is recorded only if it succeeds.
          </DialogDescription>
        </DialogHeader>
        <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="add_posts_table" />
        <div className="h-80 rounded-lg border border-border">
          <CodeEditor value={sql} onChange={setSql} editable language="sql" />
        </div>
        <Button onClick={() => void onSubmit({ name, sql })} disabled={isSubmitting}>
          Run Migration
        </Button>
      </DialogContent>
    </Dialog>
  );
}
```

- [ ] **Step 2: Create the history page**

```tsx
export default function MigrationsPage() {
  const navigate = useNavigate();
  const { data, isLoading, error, refetch, createMigration, isCreating } = useMigrations(true);
  const [open, setOpen] = useState(false);
  const [sqlModal, setSqlModal] = useState({ open: false, title: '', value: '' });

  return (
    <div className="flex h-full min-h-0 overflow-hidden bg-[rgb(var(--semantic-1))]">
      <DatabaseStudioSidebarPanel onBack={() => void navigate('/dashboard/database/tables', { state: { slideFromStudio: true } })} />
      <div className="min-w-0 flex-1 flex flex-col overflow-hidden bg-[rgb(var(--semantic-1))]">
        <TableHeader title="Database Migrations" showDividerAfterTitle />
        <DataGrid data={rows} columns={columns} showSelection={false} showPagination={false} noPadding className="h-full" />
      </div>
    </div>
  );
}
```

- [ ] **Step 3: Make the SQL column read-only through the existing SQL modal**

```tsx
renderCell: ({ row }) => (
  <SQLCellButton
    value={row.statements.join('\n\n')}
    onClick={() =>
      setSqlModal({
        open: true,
        title: `Migration ${row.sequenceNumber}: ${row.name}`,
        value: row.statements.join('\n\n'),
      })
    }
  />
)
```

- [ ] **Step 4: Handle loading, empty, and error states using the existing database page patterns**

```tsx
if (error) {
  return <EmptyState title="Failed to load migrations" description={error.message} />;
}
```

- [ ] **Step 5: Build the dashboard package**

Run: `cd /Users/lyu/Documents/GitHub/InsForge/packages/dashboard && npm run build`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add \
  packages/dashboard/src/features/database/pages/MigrationsPage.tsx \
  packages/dashboard/src/features/database/components/MigrationFormDialog.tsx
git commit -m "feat: add database migrations studio page"
```

### Task 7: Validate the Full Feature

**Files:**
- Validate: `backend/**`
- Validate: `packages/shared-schemas/**`
- Validate: `packages/dashboard/**`

- [ ] **Step 1: Run backend tests**

Run: `cd /Users/lyu/Documents/GitHub/InsForge/backend && npm test`
Expected: PASS

- [ ] **Step 2: Run backend build**

Run: `cd /Users/lyu/Documents/GitHub/InsForge/backend && npm run build`
Expected: PASS

- [ ] **Step 3: Run shared schema build**

Run: `cd /Users/lyu/Documents/GitHub/InsForge/packages/shared-schemas && npm run build`
Expected: PASS

- [ ] **Step 4: Run dashboard typecheck and build**

Run: `cd /Users/lyu/Documents/GitHub/InsForge/packages/dashboard && npm run typecheck && npm run build`
Expected: PASS

- [ ] **Step 5: Smoke-test the feature manually**

```bash
curl -X POST http://localhost:7130/api/database/migrations \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer <admin-token>" \
  -d '{"name":"create_posts","sql":"CREATE TABLE posts (id UUID PRIMARY KEY DEFAULT gen_random_uuid());"}'
```

Expected: `201` with the new migration row, and `GET /api/database/migrations` returns it.

- [ ] **Step 6: Commit final validation fixes**

```bash
git add backend packages/shared-schemas packages/dashboard
git commit -m "feat: add custom database migrations"
```
