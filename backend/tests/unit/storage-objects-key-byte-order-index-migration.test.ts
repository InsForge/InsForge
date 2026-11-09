import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const currentDir = path.dirname(fileURLToPath(import.meta.url));
const migrationsDir = path.resolve(currentDir, '../../src/infra/database/migrations');
const migrationFile = '066_storage-objects-key-byte-order-index.sql';

describe('066_storage-objects-key-byte-order-index migration', () => {
  it('indexes storage.objects keys in byte order for ListObjectsV2', () => {
    const migrationPath = path.join(migrationsDir, migrationFile);
    expect(fs.existsSync(migrationPath)).toBe(true);

    const sql = fs.readFileSync(migrationPath, 'utf8').replace(/\s+/g, ' ');
    expect(sql).toMatch(
      /CREATE INDEX IF NOT EXISTS idx_storage_objects_bucket_key_c ON storage\.objects \(bucket, key COLLATE "C"\);/
    );
  });
});
