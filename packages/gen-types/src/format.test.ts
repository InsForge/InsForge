import assert from 'node:assert/strict';
import { test } from 'node:test';
import { format } from './format.js';
import type { SchemaIR } from './types.js';

/** A fixture exercising every supported construct: table, view, enum, FK, RPC, composite. */
function fixture(): SchemaIR[] {
  return [
    {
      name: 'public',
      tables: [
        {
          name: 'posts',
          isView: false,
          insertable: true,
          updatable: true,
          columns: [
            { name: 'id', tsType: 'number', nullable: false, hasDefault: true },
            { name: 'title', tsType: 'string', nullable: false, hasDefault: false },
            { name: 'author_id', tsType: 'string', nullable: true, hasDefault: false },
            {
              name: 'status',
              tsType: 'Database["public"]["Enums"]["post_status"]',
              nullable: false,
              hasDefault: true,
            },
          ],
          relationships: [
            {
              foreignKeyName: 'posts_author_id_fkey',
              columns: ['author_id'],
              referencedRelation: 'users',
              referencedColumns: ['id'],
            },
          ],
        },
      ],
      views: [
        {
          name: 'active_posts',
          isView: true,
          insertable: false,
          updatable: false,
          columns: [{ name: 'id', tsType: 'number', nullable: true, hasDefault: false }],
          relationships: [],
        },
      ],
      enums: { post_status: ['draft', 'published'] },
      functions: [
        {
          name: 'post_count',
          args: [{ name: 'author', tsType: 'string' }],
          returns: 'number',
        },
        { name: 'now_utc', args: [], returns: 'string' },
      ],
      compositeTypes: [
        {
          name: 'point',
          fields: [
            { name: 'x', tsType: 'number', nullable: false },
            { name: 'y', tsType: 'number', nullable: false },
          ],
        },
      ],
    },
  ];
}

test('output is deterministic across runs', () => {
  assert.equal(format(fixture()), format(fixture()));
});

test('output is insensitive to input ordering', () => {
  const a = fixture();
  const b = fixture();
  b[0].tables[0].columns.reverse();
  assert.equal(format(a), format(b));
});

test('Insert marks defaulted and nullable columns optional', () => {
  const out = format(fixture());
  assert.match(out, /Insert: \{[^}]*\bid\?: number/s);
  assert.match(out, /Insert: \{[^}]*\btitle: string/s); // required, no default
  assert.match(out, /Insert: \{[^}]*\bauthor_id\?: string \| null/s);
});

test('non-writable view emits Row only, no Insert/Update', () => {
  const out = format(fixture());
  const view = out.slice(out.indexOf('active_posts'));
  assert.ok(view.includes('Row: {'));
  assert.ok(!view.slice(0, view.indexOf('}\n      }')).includes('Insert:'));
});

test('enum renders as a string union', () => {
  assert.match(format(fixture()), /post_status: "draft" \| "published"/);
});

test('functions render Args and Returns', () => {
  const out = format(fixture());
  assert.match(out, /post_count: \{\s*Args: \{\s*author: string\s*\}\s*Returns: number/s);
  assert.match(out, /now_utc: \{\s*Args: Record<PropertyKey, never>\s*Returns: string/s);
});

test('composite types render their fields', () => {
  assert.match(format(fixture()), /point: \{\s*x: number\s*y: number\s*\}/s);
});
