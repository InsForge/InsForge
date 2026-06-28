import { describe, expect, it } from 'vitest';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const currentDir = path.dirname(fileURLToPath(import.meta.url));
const migrationDir = path.resolve(currentDir, '../../src/infra/database/migrations');
const migrationFile = '059_create-vector-store-schema.sql';
const migrationPath = path.resolve(migrationDir, migrationFile);

function readMigration(): string {
  return fs.readFileSync(migrationPath, 'utf8');
}

describe('create vector store schema migration', () => {
  it('exists and is ordered after the kv migration', () => {
    expect(fs.existsSync(migrationPath)).toBe(true);
    const migrations = fs
      .readdirSync(migrationDir)
      .filter((f) => f.endsWith('.sql'))
      .sort();
    const idx = migrations.indexOf(migrationFile);
    const prev = migrations.indexOf('058_create-kv-schema.sql');
    expect(prev).not.toBe(-1);
    expect(idx).toBeGreaterThan(prev);
  });

  it('ensures pgvector and creates collections + items with a 1536-d vector', () => {
    const sql = readMigration();
    expect(sql).toMatch(/CREATE EXTENSION IF NOT EXISTS vector/i);
    expect(sql).toMatch(/CREATE SCHEMA IF NOT EXISTS vectors/i);
    expect(sql).toMatch(/CREATE TABLE IF NOT EXISTS vectors\.collections/i);
    expect(sql).toMatch(/CREATE TABLE IF NOT EXISTS vectors\.items/i);
    expect(sql).toMatch(/embedding\s+VECTOR\(1536\)/i);
  });

  it('constrains metric and cascades items on collection delete', () => {
    const sql = readMigration();
    expect(sql).toMatch(
      /metric\s+TEXT NOT NULL[\s\S]*CHECK \(metric IN \('cosine', 'l2', 'ip'\)\)/i
    );
    expect(sql).toMatch(/REFERENCES vectors\.collections\(id\) ON DELETE CASCADE/i);
  });

  it('creates the HNSW cosine index and the GIN metadata index', () => {
    const sql = readMigration();
    expect(sql).toMatch(/USING hnsw \(embedding vector_cosine_ops\)/i);
    expect(sql).toMatch(/USING gin \(metadata jsonb_path_ops\)/i);
  });

  it('enables RLS with owner-scoped policies on both tables (idempotent)', () => {
    const sql = readMigration();
    expect(sql).toMatch(/ALTER TABLE vectors\.collections ENABLE ROW LEVEL SECURITY/i);
    expect(sql).toMatch(/ALTER TABLE vectors\.items ENABLE ROW LEVEL SECURITY/i);
    for (const policy of [
      'vector_collections_select',
      'vector_collections_insert',
      'vector_items_select',
      'vector_items_insert',
    ]) {
      const dropIdx = sql.indexOf(`DROP POLICY IF EXISTS ${policy}`);
      const createIdx = sql.indexOf(`CREATE POLICY ${policy}`);
      expect(dropIdx, `${policy} drop`).toBeGreaterThan(-1);
      expect(createIdx, `${policy} create`).toBeGreaterThan(dropIdx);
    }
  });
});
