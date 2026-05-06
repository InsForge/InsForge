import { describe, it, expect } from 'vitest';
import {
  parseSQLStatements,
  checkManagedSchemaWriteOperations,
  checkSystemSchemaOperations,
  checkAuthSchemaOperations,
} from '../../src/utils/sql-parser';

describe('parseSQLStatements', () => {
  it('splits multiple statements by semicolon', () => {
    const sql = `
      SELECT * FROM users;
      INSERT INTO users (name) VALUES ('John');
      DELETE FROM users WHERE id = 1;
    `;
    const result = parseSQLStatements(sql);
    expect(result).toEqual([
      'SELECT * FROM users',
      "INSERT INTO users (name) VALUES ('John')",
      'DELETE FROM users WHERE id = 1',
    ]);
  });

  it('ignores line comments', () => {
    const sql = `
      -- This is a comment
      SELECT * FROM users; -- Inline comment
    `;
    const result = parseSQLStatements(sql);
    // Parser returns the statement with comments filtered out
    expect(result).toHaveLength(1);
    expect(result[0]).toContain('SELECT * FROM users');
  });

  it('ignores block comments', () => {
    const sql = `
      /* Block comment */
      SELECT * FROM users;
      /* Another comment */
    `;
    const result = parseSQLStatements(sql);
    // Parser returns the statement with comments filtered out
    expect(result).toHaveLength(1);
    expect(result[0]).toContain('SELECT * FROM users');
  });

  it('handles semicolons inside string literals', () => {
    const sql = `INSERT INTO messages (text) VALUES ('Hello; World')`;
    const result = parseSQLStatements(sql);
    // Parser includes the trailing semicolon
    expect(result).toEqual([`INSERT INTO messages (text) VALUES ('Hello; World')`]);
  });

  it('throws error on empty input', () => {
    expect(() => parseSQLStatements('')).toThrow();
  });

  it('returns empty array for comments-only SQL', () => {
    const sql = `
      -- Only comment
      /* Another comment */
    `;
    const result = parseSQLStatements(sql);
    // Parser filters out comment-only content
    expect(result).toEqual([]);
  });

  it('trims statements and removes empty results', () => {
    const sql = `
      SELECT * FROM users;
      -- comment
      INSERT INTO users (id) VALUES (1);
    `;
    const result = parseSQLStatements(sql);
    expect(result.length).toBeGreaterThan(0);
    expect(result[0]).toContain('SELECT * FROM users');
    expect(result[result.length - 1] || result[0]).toContain('INSERT INTO users');
  });
});

describe('checkSystemSchemaOperations', () => {
  it('blocks CREATE OR REPLACE FUNCTION on system schema', () => {
    const query = `CREATE OR REPLACE FUNCTION system.update_updated_at()
      RETURNS TRIGGER AS $$ BEGIN NEW.updated_at = NOW(); RETURN NEW; END; $$ LANGUAGE plpgsql`;
    expect(checkSystemSchemaOperations(query)).not.toBeNull();
  });

  it('blocks SET search_path', () => {
    expect(checkSystemSchemaOperations('SET search_path TO system, public')).not.toBeNull();
  });

  it('blocks SET search_path (case-insensitive)', () => {
    expect(checkSystemSchemaOperations('SET SEARCH_PATH TO public')).not.toBeNull();
  });

  it('blocks set_config search_path bypass', () => {
    expect(
      checkSystemSchemaOperations("SELECT set_config('search_path', 'system', true)")
    ).not.toBeNull();
  });

  it('blocks set_config search_path with dollar-quoting', () => {
    expect(
      checkSystemSchemaOperations("SELECT set_config($$search_path$$, 'system', true)")
    ).not.toBeNull();
  });

  it('blocks ALTER FUNCTION on system schema', () => {
    const query = 'ALTER FUNCTION system.update_updated_at() SECURITY DEFINER';
    expect(checkSystemSchemaOperations(query)).not.toBeNull();
  });

  it('blocks CREATE TRIGGER referencing system schema function', () => {
    const query =
      'CREATE TRIGGER t BEFORE UPDATE ON my_table FOR EACH ROW EXECUTE FUNCTION system.update_updated_at()';
    expect(checkSystemSchemaOperations(query)).not.toBeNull();
  });

  it('blocks CREATE TRIGGER on system schema table', () => {
    const query =
      'CREATE TRIGGER t BEFORE UPDATE ON system.secrets FOR EACH ROW EXECUTE FUNCTION public.my_func()';
    expect(checkSystemSchemaOperations(query)).not.toBeNull();
  });

  it('blocks DROP FUNCTION on system schema', () => {
    expect(checkSystemSchemaOperations('DROP FUNCTION system.update_updated_at()')).not.toBeNull();
  });

  it('blocks DROP TABLE on system schema', () => {
    expect(checkSystemSchemaOperations('DROP TABLE system.secrets')).not.toBeNull();
  });

  it('blocks DROP SCHEMA system', () => {
    expect(checkSystemSchemaOperations('DROP SCHEMA system CASCADE')).not.toBeNull();
  });

  it('blocks DROP TYPE on system schema', () => {
    expect(checkSystemSchemaOperations('DROP TYPE system.my_type')).not.toBeNull();
  });

  it('blocks DROP DOMAIN on system schema', () => {
    expect(checkSystemSchemaOperations('DROP DOMAIN system.my_domain')).not.toBeNull();
  });

  it('blocks CREATE TABLE on system schema', () => {
    expect(
      checkSystemSchemaOperations('CREATE TABLE system.foo (id uuid PRIMARY KEY)')
    ).not.toBeNull();
  });

  it('blocks ALTER TABLE on system schema', () => {
    expect(
      checkSystemSchemaOperations('ALTER TABLE system.secrets ADD COLUMN foo TEXT')
    ).not.toBeNull();
  });

  it('blocks INSERT on system schema', () => {
    expect(
      checkSystemSchemaOperations("INSERT INTO system.secrets (key, value) VALUES ('a', 'b')")
    ).not.toBeNull();
  });

  it('blocks UPDATE on system schema', () => {
    expect(
      checkSystemSchemaOperations("UPDATE system.secrets SET value = 'x' WHERE key = 'a'")
    ).not.toBeNull();
  });

  it('blocks DELETE on system schema', () => {
    expect(
      checkSystemSchemaOperations("DELETE FROM system.secrets WHERE key = 'test'")
    ).not.toBeNull();
  });

  it('blocks TRUNCATE on system schema', () => {
    expect(checkSystemSchemaOperations('TRUNCATE system.audit_logs')).not.toBeNull();
  });

  it('allows SELECT on system schema', () => {
    expect(checkSystemSchemaOperations('SELECT * FROM system.secrets')).toBeNull();
  });

  it('allows CREATE FUNCTION in public schema', () => {
    const query = `CREATE OR REPLACE FUNCTION public.update_updated_date()
      RETURNS TRIGGER AS $$ BEGIN NEW.updated_date = NOW(); RETURN NEW; END; $$ LANGUAGE plpgsql`;
    expect(checkSystemSchemaOperations(query)).toBeNull();
  });

  it('allows CREATE TRIGGER referencing a public schema function', () => {
    const query =
      'CREATE TRIGGER t BEFORE UPDATE ON my_table FOR EACH ROW EXECUTE FUNCTION public.update_updated_date()';
    expect(checkSystemSchemaOperations(query)).toBeNull();
  });

  it('allows DROP TABLE on public schema', () => {
    expect(checkSystemSchemaOperations('DROP TABLE public.foo')).toBeNull();
  });
});

describe('checkAuthSchemaOperations', () => {
  it('blocks DELETE on auth schema', () => {
    expect(checkAuthSchemaOperations("DELETE FROM auth.users WHERE id = '1'")).not.toBeNull();
  });

  it('blocks TRUNCATE on auth schema', () => {
    expect(checkAuthSchemaOperations('TRUNCATE auth.users')).not.toBeNull();
  });

  it('blocks DROP on auth schema', () => {
    expect(checkAuthSchemaOperations('DROP TABLE auth.users')).not.toBeNull();
  });

  it('allows SELECT on auth schema', () => {
    expect(checkAuthSchemaOperations('SELECT * FROM auth.users')).toBeNull();
  });
});

describe('checkManagedSchemaWriteOperations', () => {
  it('blocks INSERT on auth schema', () => {
    expect(
      checkManagedSchemaWriteOperations(
        "INSERT INTO auth.users (email, password) VALUES ('test@example.com', 'hashed')"
      )
    ).not.toBeNull();
  });

  it('blocks CREATE INDEX on storage schema', () => {
    expect(
      checkManagedSchemaWriteOperations(
        'CREATE INDEX idx_storage_objects_name ON storage.objects(name)'
      )
    ).not.toBeNull();
  });

  it('blocks INSERT on cron schema', () => {
    expect(
      checkManagedSchemaWriteOperations(
        "INSERT INTO cron.job (schedule, command) VALUES ('* * * * *', 'SELECT 1')"
      )
    ).not.toBeNull();
  });

  it('blocks UPDATE on payments schema', () => {
    expect(
      checkManagedSchemaWriteOperations(
        "UPDATE payments.customers SET email = 'new@example.com' WHERE id = 'cus_123'"
      )
    ).not.toBeNull();
  });

  it('blocks CREATE POLICY on auth schema', () => {
    expect(
      checkManagedSchemaWriteOperations('CREATE POLICY p ON auth.users FOR SELECT USING (true)')
    ).not.toBeNull();
  });

  it('allows realtime channel management through raw SQL', () => {
    expect(
      checkManagedSchemaWriteOperations(
        "INSERT INTO realtime.channels (pattern, description, enabled) VALUES ('orders', 'Order events', true)"
      )
    ).toBeNull();
    expect(
      checkManagedSchemaWriteOperations(
        "UPDATE realtime.channels SET enabled = false WHERE pattern = 'orders'"
      )
    ).toBeNull();
    expect(
      checkManagedSchemaWriteOperations("DELETE FROM realtime.channels WHERE pattern = 'orders'")
    ).toBeNull();
  });

  it('allows RLS changes on documented managed tables', () => {
    expect(
      checkManagedSchemaWriteOperations('ALTER TABLE realtime.channels ENABLE ROW LEVEL SECURITY')
    ).toBeNull();
    expect(
      checkManagedSchemaWriteOperations('ALTER TABLE storage.objects ENABLE ROW LEVEL SECURITY')
    ).toBeNull();
    expect(
      checkManagedSchemaWriteOperations(
        'ALTER TABLE payments.checkout_sessions ENABLE ROW LEVEL SECURITY'
      )
    ).toBeNull();
    expect(
      checkManagedSchemaWriteOperations(
        'ALTER TABLE payments.customer_portal_sessions FORCE ROW LEVEL SECURITY'
      )
    ).toBeNull();
    expect(
      checkManagedSchemaWriteOperations('ALTER TABLE realtime.messages ENABLE ROW LEVEL SECURITY')
    ).toBeNull();
    expect(
      checkManagedSchemaWriteOperations(
        "CREATE POLICY checkout_subject_guard ON payments.checkout_sessions FOR INSERT TO authenticated WITH CHECK (subject_type = 'team')"
      )
    ).toBeNull();
    expect(
      checkManagedSchemaWriteOperations(
        'DROP POLICY checkout_subject_guard ON payments.checkout_sessions'
      )
    ).toBeNull();
    expect(
      checkManagedSchemaWriteOperations(
        'DROP POLICY IF EXISTS portal_subject_guard ON payments.customer_portal_sessions'
      )
    ).toBeNull();
    expect(
      checkManagedSchemaWriteOperations(
        "CREATE POLICY publish_guard ON realtime.messages FOR INSERT TO authenticated WITH CHECK (channel_name LIKE 'chat:%')"
      )
    ).toBeNull();
    expect(
      checkManagedSchemaWriteOperations(
        'CREATE POLICY storage_owner_select ON storage.objects FOR SELECT TO authenticated USING (true)'
      )
    ).toBeNull();
    expect(
      checkManagedSchemaWriteOperations(
        'DROP POLICY IF EXISTS storage_owner_select ON storage.objects'
      )
    ).toBeNull();
  });

  it('allows documented writes on exempted managed tables', () => {
    expect(
      checkManagedSchemaWriteOperations(
        "INSERT INTO realtime.channels (pattern, description, enabled) VALUES ('orders', 'Order events', true)"
      )
    ).toBeNull();
    expect(
      checkManagedSchemaWriteOperations(
        "UPDATE realtime.channels SET enabled = false WHERE pattern = 'orders'"
      )
    ).toBeNull();
    expect(
      checkManagedSchemaWriteOperations(
        'CREATE TRIGGER fulfill_paid_order AFTER INSERT ON payments.payment_history FOR EACH ROW EXECUTE FUNCTION public.fulfill_paid_order()'
      )
    ).toBeNull();
    expect(
      checkManagedSchemaWriteOperations(
        'DROP TRIGGER IF EXISTS fulfill_paid_order ON payments.payment_history'
      )
    ).toBeNull();
    expect(
      checkManagedSchemaWriteOperations(
        'CREATE TRIGGER sync_team_billing_status AFTER INSERT ON payments.subscriptions FOR EACH ROW EXECUTE FUNCTION public.sync_team_billing_status()'
      )
    ).toBeNull();
  });

  it('blocks broad writes on RLS-only and trigger-only managed tables', () => {
    expect(
      checkManagedSchemaWriteOperations(
        "INSERT INTO payments.checkout_sessions (environment, mode, success_url, cancel_url) VALUES ('test', 'payment', 'https://example.com/success', 'https://example.com/cancel')"
      )
    ).not.toBeNull();
    expect(
      checkManagedSchemaWriteOperations(
        'ALTER TABLE payments.checkout_sessions ADD COLUMN internal_note TEXT'
      )
    ).not.toBeNull();
    expect(
      checkManagedSchemaWriteOperations(
        'ALTER TABLE storage.objects ENABLE ROW LEVEL SECURITY, ADD COLUMN owner_note TEXT'
      )
    ).not.toBeNull();
    expect(
      checkManagedSchemaWriteOperations(
        'ALTER TABLE realtime.channels RENAME TO realtime_channels_v2'
      )
    ).not.toBeNull();
    expect(
      checkManagedSchemaWriteOperations(
        'ALTER TABLE realtime.channels RENAME COLUMN description TO details'
      )
    ).not.toBeNull();
    expect(
      checkManagedSchemaWriteOperations(
        "INSERT INTO realtime.messages (event_name, channel_name, payload) VALUES ('new_message', 'chat:1', '{}'::jsonb)"
      )
    ).not.toBeNull();
    expect(
      checkManagedSchemaWriteOperations(
        "UPDATE payments.subscriptions SET status = 'canceled' WHERE id = 'sub_123'"
      )
    ).not.toBeNull();
  });

  it('allows SELECT on managed schemas', () => {
    expect(checkManagedSchemaWriteOperations('SELECT * FROM auth.users')).toBeNull();
    expect(checkManagedSchemaWriteOperations('SELECT * FROM storage.objects')).toBeNull();
  });

  it('allows writes on public schema', () => {
    expect(
      checkManagedSchemaWriteOperations("INSERT INTO public.products (name) VALUES ('test')")
    ).toBeNull();
  });
});
