import { PgTestClient } from 'insforge-test';
import { getConnections } from './utils';

let db: PgTestClient;
let teardown: () => Promise<void>;

const USER_ID = '550e8400-e29b-41d4-a716-446655440001';
const USER_EMAIL = 'test@example.com';

beforeAll(async () => {
  ({ db, teardown } = await getConnections());

  await db.query(`
    CREATE TABLE uid_default_test (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      owner_id UUID DEFAULT auth.uid()
    );
    GRANT ALL ON uid_default_test TO authenticated;
  `);
});

afterAll(() => teardown());
beforeEach(() => db.beforeEach());
afterEach(() => db.afterEach());

describe('auth.uid()', () => {
  it('should return the sub claim as uuid', async () => {
    db.setContext({
      role: 'authenticated',
      'request.jwt.claims': JSON.stringify({ sub: USER_ID }),
    });

    const result = await db.one(`SELECT auth.uid() AS uid`);
    expect(result.uid).toBe(USER_ID);
  });

  it('should default owner_id column via auth.uid()', async () => {
    db.setContext({
      role: 'authenticated',
      'request.jwt.claims': JSON.stringify({ sub: USER_ID }),
    });

    const row = await db.one(`INSERT INTO uid_default_test DEFAULT VALUES RETURNING *`);
    expect(row.owner_id).toBe(USER_ID);
  });
});

describe('auth.role()', () => {
  it('should return the role from jwt claims', async () => {
    db.setContext({
      role: 'authenticated',
      'request.jwt.claims': JSON.stringify({ role: 'authenticated' }),
    });

    const result = await db.one(`SELECT auth.role() AS role`);
    expect(result.role).toBe('authenticated');
  });
});

describe('auth.email()', () => {
  it('should return the email from jwt claims', async () => {
    db.setContext({
      role: 'authenticated',
      'request.jwt.claims': JSON.stringify({ sub: USER_ID, email: USER_EMAIL }),
    });

    const result = await db.one(`SELECT auth.email() AS email`);
    expect(result.email).toBe(USER_EMAIL);
  });

  it('should return null when no email claim exists', async () => {
    db.setContext({
      role: 'authenticated',
      'request.jwt.claims': JSON.stringify({ sub: USER_ID }),
    });

    const result = await db.one(`SELECT auth.email() AS email`);
    expect(result.email).toBeNull();
  });
});
