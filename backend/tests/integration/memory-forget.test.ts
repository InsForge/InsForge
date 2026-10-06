import { PgTestClient } from 'insforge-test';
import { getConnections } from './utils';

let db: PgTestClient;
let teardown: () => Promise<void>;

// MemoryService reaches for the pool through DatabaseManager; point that at the
// test database so forget() runs its real statement against real Postgres.
// getPool is called per-query, so the closure resolves db after beforeAll.
vi.mock('../../src/infra/database/database.manager.js', () => ({
  DatabaseManager: { getInstance: () => ({ getPool: () => db }) },
}));

// forget() touches neither of these, but importing the service constructs them.
vi.mock('../../src/services/ai/embedding.service.js', () => ({
  EmbeddingService: { getInstance: () => ({}) },
}));
vi.mock('../../src/services/ai/chat-completion.service.js', () => ({
  ChatCompletionService: { getInstance: () => ({}) },
}));

const SCOPE_A = 'proj-a';
const SCOPE_B = 'proj-b';

// embedding is VECTOR(1536) NOT NULL. The value is irrelevant to forget(), which
// never reads it, so a constant vector avoids needing an embedding provider.
const VECTOR_LITERAL = `('[' || array_to_string(array_fill(0.1::float8, ARRAY[1536]), ',') || ']')::vector`;

async function seed(scope: string, title: string): Promise<string> {
  const res = await db.query<{ id: string }>(
    `INSERT INTO memory.memories (scope, kind, title, content, embedding)
     VALUES ($1, 'fact', $2, $3, ${VECTOR_LITERAL})
     RETURNING id`,
    [scope, title, `content for ${title}`]
  );
  return res.rows[0].id;
}

async function scopeIds(scope: string): Promise<string[]> {
  const res = await db.query<{ id: string }>(
    `SELECT id FROM memory.memories WHERE scope = $1 ORDER BY title`,
    [scope]
  );
  return res.rows.map((r) => r.id);
}

let memoryService: { forget(p: { scope: string; ids: string[] }): Promise<string[]> };

beforeAll(async () => {
  ({ db, teardown } = await getConnections());
  const { MemoryService } = await import('../../src/services/memory/memory.service.js');
  memoryService = MemoryService.getInstance();
});

afterAll(() => teardown());
afterEach(() => db.afterEach());

beforeEach(async () => {
  await db.beforeEach();
  // memory is a platform-internal schema: migration 050 adds no grants, so only
  // its owner can reach it. The backend's own pool connects as POSTGRES_USER,
  // so run as postgres here rather than the harness's default request role.
  db.setContext({ role: 'postgres' });
});

describe('MemoryService.forget against Postgres', () => {
  it('deletes a memory in the caller scope and reports its id', async () => {
    const id = await seed(SCOPE_A, 'a1');

    await expect(memoryService.forget({ scope: SCOPE_A, ids: [id] })).resolves.toEqual([id]);
    await expect(scopeIds(SCOPE_A)).resolves.toEqual([]);
  });

  // The reason the scope predicate is in the statement rather than left to the
  // caller: an id from another scope is stale or invented, and forget cannot be
  // undone. This is the assertion the mocked-pool unit test cannot make.
  it('refuses an id from another scope and leaves that row in place', async () => {
    const idA = await seed(SCOPE_A, 'a1');
    const idB = await seed(SCOPE_B, 'b1');

    await expect(memoryService.forget({ scope: SCOPE_A, ids: [idB] })).resolves.toEqual([]);

    await expect(scopeIds(SCOPE_B)).resolves.toEqual([idB]);
    await expect(scopeIds(SCOPE_A)).resolves.toEqual([idA]);
  });

  it('deletes only the ids that exist in the scope, ignoring the rest', async () => {
    const keep = await seed(SCOPE_A, 'a1');
    const drop = await seed(SCOPE_A, 'a2');
    const idB = await seed(SCOPE_B, 'b1');
    const ghost = '99999999-9999-4999-8999-999999999999';

    const forgotten = await memoryService.forget({
      scope: SCOPE_A,
      ids: [drop, ghost, idB],
    });

    expect(forgotten).toEqual([drop]);
    await expect(scopeIds(SCOPE_A)).resolves.toEqual([keep]);
    await expect(scopeIds(SCOPE_B)).resolves.toEqual([idB]);
  });

  it('is idempotent — repeating a delete reports nothing the second time', async () => {
    const id = await seed(SCOPE_A, 'a1');

    await expect(memoryService.forget({ scope: SCOPE_A, ids: [id] })).resolves.toEqual([id]);
    await expect(memoryService.forget({ scope: SCOPE_A, ids: [id] })).resolves.toEqual([]);
  });

  it('reports an unknown id as forgotten nothing rather than failing', async () => {
    await seed(SCOPE_A, 'a1');
    const ghost = '99999999-9999-4999-8999-999999999999';

    await expect(memoryService.forget({ scope: SCOPE_A, ids: [ghost] })).resolves.toEqual([]);
    await expect(scopeIds(SCOPE_A)).resolves.toHaveLength(1);
  });
});
