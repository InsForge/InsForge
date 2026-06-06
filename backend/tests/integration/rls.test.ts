import { PgTestClient } from 'insforge-test';
import { getConnections } from './utils';

let db: PgTestClient;
let teardown: () => Promise<void>;

const USER_A = '550e8400-e29b-41d4-a716-446655440001';
const USER_B = '550e8400-e29b-41d4-a716-446655440002';
const USER_C = '550e8400-e29b-41d4-a716-446655440003';

const asUser = (userId: string) => ({
  role: 'authenticated',
  'request.jwt.claims': JSON.stringify({ sub: userId }),
});

beforeAll(async () => {
  ({ db, teardown } = await getConnections());

  await db.query(`
    CREATE TABLE todos (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      user_id UUID NOT NULL DEFAULT auth.uid(),
      title TEXT NOT NULL,
      done BOOLEAN DEFAULT false
    );
    ALTER TABLE todos ENABLE ROW LEVEL SECURITY;
    CREATE POLICY "owner_select" ON todos FOR SELECT
      TO authenticated USING (auth.uid() = user_id);
    CREATE POLICY "owner_insert" ON todos FOR INSERT
      TO authenticated WITH CHECK (auth.uid() = user_id);
    CREATE POLICY "owner_update" ON todos FOR UPDATE
      TO authenticated USING (auth.uid() = user_id);
    CREATE POLICY "owner_delete" ON todos FOR DELETE
      TO authenticated USING (auth.uid() = user_id);
    GRANT ALL ON todos TO authenticated;
  `);
});

afterAll(() => teardown());
beforeEach(() => db.beforeEach());
afterEach(() => db.afterEach());

describe('owner crud', () => {
  it('should allow user to create their own todo', async () => {
    db.setContext(asUser(USER_A));

    const todo = await db.one(`INSERT INTO todos (title) VALUES ($1) RETURNING *`, ['Buy milk']);

    expect(todo.title).toBe('Buy milk');
    expect(todo.user_id).toBe(USER_A);
  });

  it('should allow user to read only their own todos', async () => {
    db.setContext(asUser(USER_A));
    await db.one(`INSERT INTO todos (title) VALUES ($1) RETURNING id`, ['Task A']);

    db.setContext(asUser(USER_B));
    await db.one(`INSERT INTO todos (title) VALUES ($1) RETURNING id`, ['Task B']);

    db.setContext(asUser(USER_A));
    const rows = await db.many(`SELECT * FROM todos`);
    expect(rows).toHaveLength(1);
    expect(rows[0].title).toBe('Task A');
  });

  it('should allow user to update their own todo', async () => {
    db.setContext(asUser(USER_A));
    const todo = await db.one(`INSERT INTO todos (title) VALUES ($1) RETURNING id`, ['Draft']);

    const updated = await db.one(`UPDATE todos SET title = $1 WHERE id = $2 RETURNING *`, [
      'Final',
      todo.id,
    ]);
    expect(updated.title).toBe('Final');
  });

  it('should allow user to delete their own todo', async () => {
    db.setContext(asUser(USER_A));
    const todo = await db.one(`INSERT INTO todos (title) VALUES ($1) RETURNING id`, ['Remove me']);

    const result = await db.query(`DELETE FROM todos WHERE id = $1`, [todo.id]);
    expect(result.rowCount).toBe(1);
  });
});

describe('cross-user isolation', () => {
  it('should prevent user from seeing another users todos', async () => {
    db.setContext(asUser(USER_A));
    await db.one(`INSERT INTO todos (title) VALUES ($1) RETURNING id`, ['Secret']);

    db.setContext(asUser(USER_B));
    const { rows } = await db.query(`SELECT * FROM todos`);
    expect(rows).toHaveLength(0);
  });

  it('should prevent user from updating another users todo', async () => {
    db.setContext(asUser(USER_A));
    const todo = await db.one(`INSERT INTO todos (title) VALUES ($1) RETURNING id`, ['Private']);

    db.setContext(asUser(USER_B));
    const result = await db.query(`UPDATE todos SET title = 'hacked' WHERE id = $1`, [todo.id]);
    expect(result.rowCount).toBe(0);
  });

  it('should prevent user from deleting another users todo', async () => {
    db.setContext(asUser(USER_A));
    const todo = await db.one(`INSERT INTO todos (title) VALUES ($1) RETURNING id`, ['Keep me']);

    db.setContext(asUser(USER_B));
    const result = await db.query(`DELETE FROM todos WHERE id = $1`, [todo.id]);
    expect(result.rowCount).toBe(0);
  });

  it('should isolate three users from each other', async () => {
    db.setContext(asUser(USER_A));
    await db.one(`INSERT INTO todos (title) VALUES ($1) RETURNING id`, ['A task']);

    db.setContext(asUser(USER_B));
    await db.one(`INSERT INTO todos (title) VALUES ($1) RETURNING id`, ['B task']);

    db.setContext(asUser(USER_C));
    await db.one(`INSERT INTO todos (title) VALUES ($1) RETURNING id`, ['C task']);

    // Each user sees only their own
    db.setContext(asUser(USER_A));
    const aRows = await db.many(`SELECT * FROM todos`);
    expect(aRows).toHaveLength(1);
    expect(aRows[0].title).toBe('A task');

    db.setContext(asUser(USER_B));
    const bRows = await db.many(`SELECT * FROM todos`);
    expect(bRows).toHaveLength(1);
    expect(bRows[0].title).toBe('B task');

    db.setContext(asUser(USER_C));
    const cRows = await db.many(`SELECT * FROM todos`);
    expect(cRows).toHaveLength(1);
    expect(cRows[0].title).toBe('C task');
  });
});

describe('role access control', () => {
  it('should block anon from reading any data', async () => {
    db.setContext(asUser(USER_A));
    await db.one(`INSERT INTO todos (title) VALUES ($1) RETURNING id`, ['Exists']);

    db.setContext({ role: 'anon' });
    const { rows } = await db.query(`SELECT * FROM todos`);
    expect(rows).toHaveLength(0);
  });

  it('should allow project_admin to bypass RLS via auto-generated policy', async () => {
    db.setContext(asUser(USER_A));
    await db.one(`INSERT INTO todos (title) VALUES ($1) RETURNING id`, ['Admin can see me']);

    db.setContext(asUser(USER_B));
    await db.one(`INSERT INTO todos (title) VALUES ($1) RETURNING id`, ['Admin sees this too']);

    db.setContext({ role: 'project_admin' });
    const rows = await db.many(`SELECT * FROM todos`);
    expect(rows.length).toBeGreaterThanOrEqual(2);
  });
});
