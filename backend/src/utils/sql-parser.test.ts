import { describe, it, expect } from 'vitest';
import { analyzeQuery } from './sql-parser.js';

describe('analyzeQuery', () => {
  // ===================
  // RECORDS (DML) - with table name
  // ===================
  describe('records - INSERT', () => {
    it('simple insert', () => {
      expect(analyzeQuery('INSERT INTO users (name) VALUES ("john")')).toEqual([
        { type: 'records', name: 'users' },
      ]);
    });

    it('insert with schema', () => {
      expect(analyzeQuery('INSERT INTO public.users (name) VALUES ("john")')).toEqual([
        { type: 'records', name: 'users' },
      ]);
    });

    it('insert multiple rows', () => {
      expect(analyzeQuery("INSERT INTO products (name) VALUES ('a'), ('b'), ('c')")).toEqual([
        { type: 'records', name: 'products' },
      ]);
    });

    it('insert with returning', () => {
      expect(analyzeQuery('INSERT INTO orders (total) VALUES (100) RETURNING id')).toEqual([
        { type: 'records', name: 'orders' },
      ]);
    });

    it('insert with on conflict', () => {
      expect(
        analyzeQuery(
          'INSERT INTO users (id, name) VALUES (1, "john") ON CONFLICT (id) DO UPDATE SET name = EXCLUDED.name'
        )
      ).toEqual([{ type: 'records', name: 'users' }]);
    });

    it('insert from select', () => {
      expect(
        analyzeQuery('INSERT INTO archive SELECT * FROM logs WHERE created_at < NOW()')
      ).toEqual([{ type: 'records', name: 'archive' }]);
    });
  });

  describe('records - UPDATE', () => {
    it('simple update', () => {
      expect(analyzeQuery('UPDATE users SET name = "jane" WHERE id = 1')).toEqual([
        { type: 'records', name: 'users' },
      ]);
    });

    it('update with schema', () => {
      expect(analyzeQuery('UPDATE public.posts SET title = "new" WHERE id = 1')).toEqual([
        { type: 'records', name: 'posts' },
      ]);
    });

    it('update multiple columns', () => {
      expect(
        analyzeQuery(
          'UPDATE users SET name = "jane", email = "jane@test.com", updated_at = NOW() WHERE id = 1'
        )
      ).toEqual([{ type: 'records', name: 'users' }]);
    });

    it('update with subquery', () => {
      expect(
        analyzeQuery(
          'UPDATE orders SET status = "shipped" WHERE id IN (SELECT order_id FROM shipments)'
        )
      ).toEqual([{ type: 'records', name: 'orders' }]);
    });

    it('update with returning', () => {
      expect(analyzeQuery('UPDATE products SET price = price * 1.1 RETURNING id, price')).toEqual([
        { type: 'records', name: 'products' },
      ]);
    });
  });

  describe('records - DELETE', () => {
    it('simple delete', () => {
      expect(analyzeQuery('DELETE FROM users WHERE id = 1')).toEqual([
        { type: 'records', name: 'users' },
      ]);
    });

    it('delete with schema', () => {
      expect(analyzeQuery('DELETE FROM public.logs WHERE created_at < NOW()')).toEqual([
        { type: 'records', name: 'logs' },
      ]);
    });

    it('delete all', () => {
      expect(analyzeQuery('DELETE FROM temp_table')).toEqual([
        { type: 'records', name: 'temp_table' },
      ]);
    });

    it('delete with subquery', () => {
      expect(
        analyzeQuery(
          'DELETE FROM orders WHERE user_id IN (SELECT id FROM users WHERE banned = true)'
        )
      ).toEqual([{ type: 'records', name: 'orders' }]);
    });

    it('delete with returning', () => {
      expect(analyzeQuery('DELETE FROM sessions WHERE expired = true RETURNING id')).toEqual([
        { type: 'records', name: 'sessions' },
      ]);
    });
  });

  // ===================
  // TABLES (CREATE/DROP) - no name
  // ===================
  describe('tables - CREATE/DROP TABLE', () => {
    it('create table', () => {
      expect(analyzeQuery('CREATE TABLE users (id INT)')).toEqual([{ type: 'tables' }]);
    });

    it('create table if not exists', () => {
      expect(analyzeQuery('CREATE TABLE IF NOT EXISTS posts (id UUID PRIMARY KEY)')).toEqual([
        { type: 'tables' },
      ]);
    });

    it('create table with schema', () => {
      expect(analyzeQuery('CREATE TABLE public.comments (id SERIAL PRIMARY KEY)')).toEqual([
        { type: 'tables' },
      ]);
    });

    it('create table with constraints', () => {
      expect(
        analyzeQuery(
          'CREATE TABLE orders (id UUID PRIMARY KEY, user_id UUID REFERENCES users(id), total DECIMAL NOT NULL)'
        )
      ).toEqual([{ type: 'tables' }]);
    });

    it('drop table', () => {
      expect(analyzeQuery('DROP TABLE users')).toEqual([{ type: 'tables' }]);
    });

    it('drop table if exists', () => {
      expect(analyzeQuery('DROP TABLE IF EXISTS temp_data')).toEqual([{ type: 'tables' }]);
    });

    it('drop table cascade', () => {
      expect(analyzeQuery('DROP TABLE orders CASCADE')).toEqual([{ type: 'tables' }]);
    });
  });

  // ===================
  // TABLE (ALTER) - with name
  // ===================
  describe('table - ALTER TABLE', () => {
    it('add column', () => {
      expect(analyzeQuery('ALTER TABLE users ADD COLUMN email VARCHAR(255)')).toEqual([
        { type: 'table', name: 'users' },
      ]);
    });

    it('drop column', () => {
      expect(analyzeQuery('ALTER TABLE posts DROP COLUMN temp_field')).toEqual([
        { type: 'table', name: 'posts' },
      ]);
    });

    it('rename column', () => {
      expect(analyzeQuery('ALTER TABLE users RENAME COLUMN name TO full_name')).toEqual([
        { type: 'table', name: 'users' },
      ]);
    });

    it('alter column type', () => {
      expect(analyzeQuery('ALTER TABLE products ALTER COLUMN price TYPE NUMERIC(10,2)')).toEqual([
        { type: 'table', name: 'products' },
      ]);
    });

    it('add constraint', () => {
      expect(
        analyzeQuery(
          'ALTER TABLE orders ADD CONSTRAINT fk_user FOREIGN KEY (user_id) REFERENCES users(id)'
        )
      ).toEqual([{ type: 'table', name: 'orders' }]);
    });

    it('enable RLS', () => {
      expect(analyzeQuery('ALTER TABLE users ENABLE ROW LEVEL SECURITY')).toEqual([
        { type: 'table', name: 'users' },
      ]);
    });

    it('disable RLS', () => {
      expect(analyzeQuery('ALTER TABLE users DISABLE ROW LEVEL SECURITY')).toEqual([
        { type: 'table', name: 'users' },
      ]);
    });

    it('force RLS', () => {
      expect(analyzeQuery('ALTER TABLE users FORCE ROW LEVEL SECURITY')).toEqual([
        { type: 'table', name: 'users' },
      ]);
    });

    it('set not null', () => {
      expect(analyzeQuery('ALTER TABLE users ALTER COLUMN email SET NOT NULL')).toEqual([
        { type: 'table', name: 'users' },
      ]);
    });

    it('set default', () => {
      expect(analyzeQuery('ALTER TABLE users ALTER COLUMN created_at SET DEFAULT NOW()')).toEqual([
        { type: 'table', name: 'users' },
      ]);
    });
  });

  // ===================
  // INDEX - no name
  // ===================
  describe('index', () => {
    it('create index', () => {
      expect(analyzeQuery('CREATE INDEX idx_users_email ON users (email)')).toEqual([
        { type: 'index' },
      ]);
    });

    it('create unique index', () => {
      expect(analyzeQuery('CREATE UNIQUE INDEX idx_users_email ON users (email)')).toEqual([
        { type: 'index' },
      ]);
    });

    it('create index concurrently', () => {
      expect(
        analyzeQuery('CREATE INDEX CONCURRENTLY idx_orders_date ON orders (created_at)')
      ).toEqual([{ type: 'index' }]);
    });

    it('create partial index', () => {
      expect(
        analyzeQuery('CREATE INDEX idx_active_users ON users (id) WHERE active = true')
      ).toEqual([{ type: 'index' }]);
    });

    it('create index with expression', () => {
      expect(analyzeQuery('CREATE INDEX idx_users_lower_email ON users (LOWER(email))')).toEqual([
        { type: 'index' },
      ]);
    });

    it('drop index', () => {
      expect(analyzeQuery('DROP INDEX idx_users_email')).toEqual([{ type: 'index' }]);
    });

    it('drop index if exists', () => {
      expect(analyzeQuery('DROP INDEX IF EXISTS idx_old')).toEqual([{ type: 'index' }]);
    });
  });

  // ===================
  // TRIGGER - no name
  // ===================
  describe('trigger', () => {
    it('create trigger before insert', () => {
      expect(
        analyzeQuery(
          'CREATE TRIGGER set_timestamp BEFORE INSERT ON users FOR EACH ROW EXECUTE FUNCTION update_modified()'
        )
      ).toEqual([{ type: 'trigger' }]);
    });

    it('create trigger after update', () => {
      expect(
        analyzeQuery(
          'CREATE TRIGGER audit_log AFTER UPDATE ON orders FOR EACH ROW EXECUTE FUNCTION log_changes()'
        )
      ).toEqual([{ type: 'trigger' }]);
    });

    it('create trigger before delete', () => {
      expect(
        analyzeQuery(
          'CREATE TRIGGER prevent_delete BEFORE DELETE ON users FOR EACH ROW EXECUTE FUNCTION check_delete()'
        )
      ).toEqual([{ type: 'trigger' }]);
    });

    it('create or replace trigger', () => {
      expect(
        analyzeQuery(
          'CREATE OR REPLACE TRIGGER update_ts BEFORE UPDATE ON posts FOR EACH ROW EXECUTE FUNCTION update_modified()'
        )
      ).toEqual([{ type: 'trigger' }]);
    });

    it('drop trigger', () => {
      expect(analyzeQuery('DROP TRIGGER update_timestamp ON users')).toEqual([{ type: 'trigger' }]);
    });

    it('drop trigger if exists', () => {
      expect(analyzeQuery('DROP TRIGGER IF EXISTS old_trigger ON users')).toEqual([
        { type: 'trigger' },
      ]);
    });
  });

  // ===================
  // POLICY - no name
  // ===================
  describe('policy', () => {
    it('create policy for select', () => {
      expect(
        analyzeQuery('CREATE POLICY user_select ON users FOR SELECT USING (id = current_user_id())')
      ).toEqual([{ type: 'policy' }]);
    });

    it('create policy for insert', () => {
      expect(
        analyzeQuery('CREATE POLICY user_insert ON users FOR INSERT WITH CHECK (true)')
      ).toEqual([{ type: 'policy' }]);
    });

    it('create policy for update', () => {
      expect(
        analyzeQuery(
          'CREATE POLICY user_update ON users FOR UPDATE USING (id = current_user_id()) WITH CHECK (id = current_user_id())'
        )
      ).toEqual([{ type: 'policy' }]);
    });

    it('create policy for delete', () => {
      expect(
        analyzeQuery('CREATE POLICY user_delete ON users FOR DELETE USING (id = current_user_id())')
      ).toEqual([{ type: 'policy' }]);
    });

    it('create policy for all', () => {
      expect(
        analyzeQuery(
          'CREATE POLICY full_access ON orders FOR ALL USING (user_id = current_user_id())'
        )
      ).toEqual([{ type: 'policy' }]);
    });

    it('create permissive policy', () => {
      expect(
        analyzeQuery(
          'CREATE POLICY admin_access ON users AS PERMISSIVE FOR ALL TO admin USING (true)'
        )
      ).toEqual([{ type: 'policy' }]);
    });

    it('create restrictive policy', () => {
      expect(
        analyzeQuery(
          'CREATE POLICY tenant_isolation ON orders AS RESTRICTIVE FOR ALL USING (tenant_id = current_tenant())'
        )
      ).toEqual([{ type: 'policy' }]);
    });

    it('alter policy', () => {
      expect(
        analyzeQuery(
          'ALTER POLICY user_select ON users USING (id = current_user_id() OR is_admin())'
        )
      ).toEqual([{ type: 'policy' }]);
    });

    it('drop policy', () => {
      expect(analyzeQuery('DROP POLICY user_policy ON users')).toEqual([{ type: 'policy' }]);
    });

    it('drop policy if exists', () => {
      expect(analyzeQuery('DROP POLICY IF EXISTS old_policy ON users')).toEqual([
        { type: 'policy' },
      ]);
    });
  });

  // ===================
  // FUNCTION - no name
  // ===================
  describe('function', () => {
    it('create function sql', () => {
      expect(
        analyzeQuery(
          'CREATE FUNCTION get_user(id INT) RETURNS TEXT AS $$ SELECT name FROM users WHERE id = $1 $$ LANGUAGE sql'
        )
      ).toEqual([{ type: 'function' }]);
    });

    it('create function plpgsql', () => {
      expect(
        analyzeQuery(
          'CREATE FUNCTION update_modified() RETURNS TRIGGER AS $$ BEGIN NEW.updated_at = NOW(); RETURN NEW; END; $$ LANGUAGE plpgsql'
        )
      ).toEqual([{ type: 'function' }]);
    });

    it('create or replace function', () => {
      expect(
        analyzeQuery(
          'CREATE OR REPLACE FUNCTION current_user_id() RETURNS UUID AS $$ SELECT auth.uid() $$ LANGUAGE sql'
        )
      ).toEqual([{ type: 'function' }]);
    });

    it('create function with security definer', () => {
      expect(
        analyzeQuery(
          'CREATE FUNCTION admin_action() RETURNS VOID AS $$ UPDATE users SET role = "admin" $$ LANGUAGE sql SECURITY DEFINER'
        )
      ).toEqual([{ type: 'function' }]);
    });

    it('drop function', () => {
      expect(analyzeQuery('DROP FUNCTION get_user')).toEqual([{ type: 'function' }]);
    });

    it('drop function with args', () => {
      expect(analyzeQuery('DROP FUNCTION get_user(INT)')).toEqual([{ type: 'function' }]);
    });

    it('drop function if exists', () => {
      expect(analyzeQuery('DROP FUNCTION IF EXISTS old_func')).toEqual([{ type: 'function' }]);
    });
  });

  // ===================
  // EXTENSION - no name
  // ===================
  describe('extension', () => {
    it('create extension', () => {
      expect(analyzeQuery('CREATE EXTENSION "uuid-ossp"')).toEqual([{ type: 'extension' }]);
    });

    it('create extension if not exists', () => {
      expect(analyzeQuery('CREATE EXTENSION IF NOT EXISTS pgcrypto')).toEqual([
        { type: 'extension' },
      ]);
    });

    it('create extension with schema', () => {
      expect(analyzeQuery('CREATE EXTENSION hstore WITH SCHEMA public')).toEqual([
        { type: 'extension' },
      ]);
    });

    it('drop extension', () => {
      expect(analyzeQuery('DROP EXTENSION "uuid-ossp"')).toEqual([{ type: 'extension' }]);
    });

    it('drop extension cascade', () => {
      expect(analyzeQuery('DROP EXTENSION pgcrypto CASCADE')).toEqual([{ type: 'extension' }]);
    });
  });

  // ===================
  // SELECT - ignored
  // ===================
  describe('SELECT (ignored)', () => {
    it('simple select', () => {
      expect(analyzeQuery('SELECT * FROM users')).toEqual([]);
    });

    it('select with joins', () => {
      expect(
        analyzeQuery('SELECT u.*, p.title FROM users u JOIN posts p ON u.id = p.user_id')
      ).toEqual([]);
    });

    it('select with subquery', () => {
      expect(analyzeQuery('SELECT * FROM users WHERE id IN (SELECT user_id FROM orders)')).toEqual(
        []
      );
    });

    it('select with cte', () => {
      expect(
        analyzeQuery(
          'WITH active_users AS (SELECT * FROM users WHERE active) SELECT * FROM active_users'
        )
      ).toEqual([]);
    });

    it('select for update (still ignored)', () => {
      expect(analyzeQuery('SELECT * FROM users WHERE id = 1 FOR UPDATE')).toEqual([]);
    });
  });

  // ===================
  // MULTI-STATEMENT
  // ===================
  describe('multi-statement', () => {
    it('multiple inserts', () => {
      const result = analyzeQuery(
        "INSERT INTO users (name) VALUES ('a'); INSERT INTO posts (title) VALUES ('b');"
      );
      expect(result).toEqual([
        { type: 'records', name: 'users' },
        { type: 'records', name: 'posts' },
      ]);
    });

    it('create table + insert', () => {
      const result = analyzeQuery('CREATE TABLE temp (id INT); INSERT INTO temp VALUES (1);');
      expect(result).toEqual([{ type: 'tables' }, { type: 'records', name: 'temp' }]);
    });

    it('full table setup with RLS', () => {
      const result = analyzeQuery(`
        CREATE TABLE orders (id UUID PRIMARY KEY, user_id UUID NOT NULL);
        ALTER TABLE orders ENABLE ROW LEVEL SECURITY;
        CREATE POLICY orders_select ON orders FOR SELECT USING (user_id = auth.uid());
        CREATE INDEX idx_orders_user ON orders (user_id);
      `);
      expect(result).toHaveLength(4);
      expect(result[0]).toEqual({ type: 'tables' });
      expect(result[1]).toEqual({ type: 'table', name: 'orders' });
      expect(result[2]).toEqual({ type: 'policy' });
      expect(result[3]).toEqual({ type: 'index' });
    });

    it('migration: drop and recreate', () => {
      const result = analyzeQuery(`
        DROP TABLE IF EXISTS old_data;
        DROP INDEX IF EXISTS idx_old;
        DROP POLICY IF EXISTS old_policy ON users;
        CREATE TABLE new_data (id INT);
        ALTER TABLE users ADD COLUMN new_col TEXT;
      `);
      // tables is deduplicated (DROP + CREATE both emit 'tables')
      expect(result).toHaveLength(4);
      expect(result).toContainEqual({ type: 'tables' });
      expect(result).toContainEqual({ type: 'index' });
      expect(result).toContainEqual({ type: 'policy' });
      expect(result).toContainEqual({ type: 'table', name: 'users' });
    });

    it('batch DML operations', () => {
      const result = analyzeQuery(`
        INSERT INTO products (name) VALUES ('new');
        UPDATE products SET price = 100 WHERE name = 'new';
        DELETE FROM products WHERE stock = 0;
      `);
      // Deduplicated to single entry
      expect(result).toEqual([{ type: 'records', name: 'products' }]);
    });

    it('mixed with selects (selects ignored)', () => {
      const result = analyzeQuery(`
        SELECT * FROM users;
        INSERT INTO logs (action) VALUES ('viewed');
        SELECT COUNT(*) FROM logs;
      `);
      expect(result).toEqual([{ type: 'records', name: 'logs' }]);
    });

    it('complete app setup', () => {
      const result = analyzeQuery(`
        CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
        CREATE TABLE users (id UUID DEFAULT uuid_generate_v4() PRIMARY KEY, email TEXT UNIQUE);
        CREATE TABLE posts (id UUID PRIMARY KEY, user_id UUID REFERENCES users(id), title TEXT);
        CREATE INDEX idx_posts_user ON posts (user_id);
        ALTER TABLE users ENABLE ROW LEVEL SECURITY;
        ALTER TABLE posts ENABLE ROW LEVEL SECURITY;
        CREATE POLICY users_policy ON users FOR ALL USING (id = auth.uid());
        CREATE POLICY posts_policy ON posts FOR ALL USING (user_id = auth.uid());
        CREATE FUNCTION auth.uid() RETURNS UUID AS $$ SELECT current_setting('app.user_id')::UUID $$ LANGUAGE sql;
      `);
      // Deduplicated: 2 CREATE TABLEs -> 1 'tables', 2 CREATE POLICYs -> 1 'policy'
      expect(result).toHaveLength(7);
      expect(result.filter((r) => r.type === 'extension')).toHaveLength(1);
      expect(result.filter((r) => r.type === 'tables')).toHaveLength(1);
      expect(result.filter((r) => r.type === 'index')).toHaveLength(1);
      expect(result.filter((r) => r.type === 'table')).toHaveLength(2); // ALTER users + ALTER posts (different names)
      expect(result.filter((r) => r.type === 'policy')).toHaveLength(1);
      expect(result.filter((r) => r.type === 'function')).toHaveLength(1);
    });
  });

  // ===================
  // EDGE CASES
  // ===================
  describe('edge cases', () => {
    it('empty string', () => {
      expect(analyzeQuery('')).toEqual([]);
    });

    it('whitespace only', () => {
      expect(analyzeQuery('   \n\t  ')).toEqual([]);
    });

    it('comment only', () => {
      expect(analyzeQuery('-- this is a comment')).toEqual([]);
    });

    it('block comment only', () => {
      expect(analyzeQuery('/* block comment */')).toEqual([]);
    });

    it('invalid SQL', () => {
      expect(analyzeQuery('THIS IS NOT SQL')).toEqual([]);
    });

    it('table name with underscore', () => {
      expect(analyzeQuery('INSERT INTO user_profiles (name) VALUES ("test")')).toEqual([
        { type: 'records', name: 'user_profiles' },
      ]);
    });

    it('table name with quotes', () => {
      expect(analyzeQuery('INSERT INTO "user-data" (name) VALUES ("test")')).toEqual([
        { type: 'records', name: 'user-data' },
      ]);
    });

    it('schema qualified table', () => {
      expect(analyzeQuery('UPDATE myschema.mytable SET x = 1')).toEqual([
        { type: 'records', name: 'mytable' },
      ]);
    });

    it('semicolon in string literal', () => {
      expect(analyzeQuery("INSERT INTO logs (msg) VALUES ('hello; world')")).toEqual([
        { type: 'records', name: 'logs' },
      ]);
    });
  });

  // ===================
  // DEDUPLICATION
  // ===================
  describe('deduplication', () => {
    it('deduplicates multiple inserts to same table', () => {
      const result = analyzeQuery(`
        INSERT INTO users (name) VALUES ('a');
        INSERT INTO users (name) VALUES ('b');
        INSERT INTO users (name) VALUES ('c');
      `);
      expect(result).toEqual([{ type: 'records', name: 'users' }]);
    });

    it('deduplicates multiple updates to same table', () => {
      const result = analyzeQuery(`
        UPDATE products SET price = 10 WHERE id = 1;
        UPDATE products SET price = 20 WHERE id = 2;
      `);
      expect(result).toEqual([{ type: 'records', name: 'products' }]);
    });

    it('keeps different tables separate', () => {
      const result = analyzeQuery(`
        INSERT INTO users (name) VALUES ('a');
        INSERT INTO posts (title) VALUES ('b');
        INSERT INTO users (name) VALUES ('c');
      `);
      expect(result).toEqual([
        { type: 'records', name: 'users' },
        { type: 'records', name: 'posts' },
      ]);
    });

    it('keeps different types separate', () => {
      const result = analyzeQuery(`
        INSERT INTO users (name) VALUES ('a');
        ALTER TABLE users ADD COLUMN foo TEXT;
      `);
      expect(result).toEqual([
        { type: 'records', name: 'users' },
        { type: 'table', name: 'users' },
      ]);
    });

    it('deduplicates DDL without names', () => {
      const result = analyzeQuery(`
        CREATE INDEX idx1 ON users (a);
        CREATE INDEX idx2 ON users (b);
        CREATE INDEX idx3 ON posts (c);
      `);
      expect(result).toEqual([{ type: 'index' }]);
    });
  });
});
