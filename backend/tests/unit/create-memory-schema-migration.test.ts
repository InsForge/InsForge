import { describe, expect, it } from 'vitest';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const currentDir = path.dirname(fileURLToPath(import.meta.url));
const migrationDir = path.resolve(currentDir, '../../src/infra/database/migrations');
const migrationFile = '050_create-memory-schema.sql';
const migrationPath = path.resolve(migrationDir, migrationFile);

function readMigration(): string {
  return fs.readFileSync(migrationPath, 'utf8');
}

describe('create memory schema migration', () => {
  it('exists and is ordered after the prior migration', () => {
    expect(fs.existsSync(migrationPath)).toBe(true);
    const migrations = fs
      .readdirSync(migrationDir)
      .filter((f) => f.endsWith('.sql'))
      .sort();
    const idx = migrations.indexOf(migrationFile);
    const prev = migrations.indexOf('049_add-multi-provider-payments-foundation.sql');
    expect(prev).not.toBe(-1);
    expect(idx).toBeGreaterThan(prev);
  });

  it('enables pgvector and creates the memory.memories table with a 1536-d vector', () => {
    const sql = readMigration();
    expect(sql).toMatch(/CREATE EXTENSION IF NOT EXISTS vector/i);
    expect(sql).toMatch(/CREATE SCHEMA IF NOT EXISTS memory/i);
    expect(sql).toMatch(/CREATE TABLE IF NOT EXISTS memory\.memories/i);
    expect(sql).toMatch(/embedding\s+VECTOR\(1536\)/i);
  });

  it('constrains kind to the four memory kinds', () => {
    const sql = readMigration();
    expect(sql).toMatch(/kind\s+TEXT\s+NOT NULL\s+CHECK\s*\(kind IN \('fact', 'decision', 'preference', 'reference'\)\)/i);
  });

  it('creates the HNSW vector index and the GIN full-text index for hybrid recall', () => {
    const sql = readMigration();
    expect(sql).toMatch(/USING hnsw \(embedding vector_cosine_ops\)/i);
    expect(sql).toMatch(/content_tsv\s+TSVECTOR GENERATED ALWAYS AS/i);
    expect(sql).toMatch(/USING gin \(content_tsv\)/i);
  });

  it('is idempotent on the trigger (DROP TRIGGER IF EXISTS before CREATE)', () => {
    const sql = readMigration();
    expect(sql).toMatch(/DROP TRIGGER IF EXISTS trg_memories_updated_at ON memory\.memories/i);
    const dropIdx = sql.indexOf('DROP TRIGGER IF EXISTS trg_memories_updated_at');
    const createIdx = sql.indexOf('CREATE TRIGGER trg_memories_updated_at');
    expect(dropIdx).toBeGreaterThan(-1);
    expect(createIdx).toBeGreaterThan(dropIdx);
  });
});
