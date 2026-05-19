import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { Client } from 'pg';
import { format } from './format.js';
import { introspect } from './introspect.js';

/**
 * Integration test: introspects a real Postgres instance.
 *
 * Skipped unless `GEN_TYPES_TEST_DB` points at a reachable Postgres, e.g.:
 *   docker run -d --name gt -e POSTGRES_PASSWORD=postgres -p 5432:5432 postgres:16
 *   GEN_TYPES_TEST_DB=postgres://postgres:postgres@localhost:5432/postgres npm test
 */
const CONN = process.env.GEN_TYPES_TEST_DB;
const SCHEMA = 'gen_types_it';

const SEED = `
DROP SCHEMA IF EXISTS ${SCHEMA} CASCADE;
CREATE SCHEMA ${SCHEMA};
CREATE TYPE ${SCHEMA}.post_status AS ENUM ('draft','published');
CREATE TYPE ${SCHEMA}.point2d AS (x float8, y float8);
CREATE TABLE ${SCHEMA}.users (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email text NOT NULL,
  age int4,
  meta jsonb,
  created_at timestamptz DEFAULT now()
);
CREATE TABLE ${SCHEMA}.posts (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  title text NOT NULL,
  status ${SCHEMA}.post_status NOT NULL DEFAULT 'draft',
  author_id uuid REFERENCES ${SCHEMA}.users(id),
  tags text[]
);
CREATE VIEW ${SCHEMA}.active_posts AS SELECT id, title FROM ${SCHEMA}.posts;
CREATE FUNCTION ${SCHEMA}.post_count(author uuid) RETURNS bigint
  LANGUAGE sql AS $$ SELECT count(*) FROM ${SCHEMA}.posts WHERE author_id = author $$;
`;

before(async () => {
  if (!CONN) {
    return;
  }
  const client = new Client({ connectionString: CONN });
  await client.connect();
  await client.query(SEED);
  await client.end();
});

after(async () => {
  if (!CONN) {
    return;
  }
  const client = new Client({ connectionString: CONN });
  await client.connect();
  await client.query(`DROP SCHEMA IF EXISTS ${SCHEMA} CASCADE`);
  await client.end();
});

test('introspects every supported construct against a live database', { skip: !CONN }, async () => {
  const schemas = await introspect({ connectionString: CONN!, schemas: [SCHEMA] });
  const out = format(schemas);

  // tables, view, enum, FK, RPC, composite all present
  assert.match(out, /posts: \{/);
  assert.match(out, /users: \{/);
  assert.match(out, /active_posts: \{/);
  assert.match(out, /post_status: "draft" \| "published"/);
  assert.match(out, /foreignKeyName: "posts_author_id_fkey"/);
  assert.match(out, /post_count: \{/);
  assert.match(out, /point2d: \{/);

  // identity column optional in Insert; required non-default column stays required
  assert.match(out, /Insert: \{[^}]*\bid\?: number/s);
  assert.match(out, /Insert: \{[^}]*\btitle: string\b/s);

  // deterministic
  assert.equal(format(schemas), out);
});
