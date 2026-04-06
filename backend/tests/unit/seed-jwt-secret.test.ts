import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

describe('seedBackend JWT_SECRET initialization', () => {
  const currentDir = path.dirname(fileURLToPath(import.meta.url));
  const seedPath = path.resolve(currentDir, '../../src/utils/seed.ts');
  const seedSource = fs.readFileSync(seedPath, 'utf8');

  it('reads JWT_SECRET from process.env', () => {
    expect(seedSource).toContain('process.env.JWT_SECRET');
  });

  it('stores JWT_SECRET as a reserved secret', () => {
    expect(seedSource).toContain("key: 'JWT_SECRET'");
    expect(seedSource).toContain('isReserved: true');
  });

  it('only creates JWT_SECRET if it does not already exist', () => {
    expect(seedSource).toContain("getSecretByKey('JWT_SECRET')");
    expect(seedSource).toMatch(/existingJwtSecret\s*===\s*null/);
  });
});
