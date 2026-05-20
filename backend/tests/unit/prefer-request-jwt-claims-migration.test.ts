import { describe, expect, it } from 'vitest';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const currentDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(currentDir, '../../..');
const migrationDir = path.resolve(currentDir, '../../src/infra/database/migrations');
const migrationPath = path.resolve(migrationDir, '044_prefer-request-jwt-claims.sql');

const historicalDottedClaimMigrations = new Set([
  'backend/src/infra/database/migrations/001_create-helper-functions.sql',
  'backend/src/infra/database/migrations/013_create-auth-schema-functions.sql',
]);

function toPosixRelative(filePath: string): string {
  return path.relative(repoRoot, filePath).split(path.sep).join('/');
}

function collectFiles(dir: string, predicate: (filePath: string) => boolean): string[] {
  const ignoredDirs = new Set(['.git', 'node_modules', 'dist', 'coverage']);
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  const files: string[] = [];

  for (const entry of entries) {
    const entryPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (!ignoredDirs.has(entry.name)) {
        files.push(...collectFiles(entryPath, predicate));
      }
      continue;
    }

    if (entry.isFile() && predicate(entryPath)) {
      files.push(entryPath);
    }
  }

  return files;
}

function readRepoFiles(
  paths: string[],
  extensions: string[]
): Array<{ path: string; content: string }> {
  return paths.flatMap((relativePath) => {
    const absolutePath = path.resolve(repoRoot, relativePath);
    if (!fs.existsSync(absolutePath)) {
      return [];
    }

    return collectFiles(absolutePath, (filePath) =>
      extensions.some((extension) => filePath.endsWith(extension))
    ).map((filePath) => ({
      path: toPosixRelative(filePath),
      content: fs.readFileSync(filePath, 'utf8'),
    }));
  });
}

describe('044_prefer-request-jwt-claims migration', () => {
  const sql = fs.readFileSync(migrationPath, 'utf8');

  it('migration file exists', () => {
    expect(fs.existsSync(migrationPath)).toBe(true);
  });

  it.each(['uid', 'role', 'email'])('redefines auth.%s with CREATE OR REPLACE', (fnName) => {
    expect(sql).toMatch(new RegExp(`CREATE OR REPLACE FUNCTION auth\\.${fnName}\\(\\)`, 'i'));
  });

  it.each([
    ['uid', 'sub'],
    ['role', 'role'],
    ['email', 'email'],
  ])('auth.%s reads only canonical auth.jwt() claim %s', (_fnName, claimName) => {
    expect(sql).toMatch(
      new RegExp(`SELECT nullif\\(auth\\.jwt\\(\\)\\s*->>\\s*'${claimName}',\\s*''\\)::`, 'i')
    );
  });

  it('does not keep legacy dotted claim fallback', () => {
    expect(sql).not.toMatch(/request\.jwt\.claim\./i);
  });

  it('does not add or replace public helper functions', () => {
    expect(sql).not.toMatch(/CREATE OR REPLACE FUNCTION public\./i);
  });

  it('grants only missing storage runtime roles required before RLS can evaluate', () => {
    expect(sql).toMatch(
      /GRANT\s+USAGE\s+ON\s+SCHEMA\s+storage\s+TO\s+anon,\s*project_admin/i
    );
    expect(sql).toMatch(
      /GRANT\s+SELECT,\s*INSERT,\s*UPDATE,\s*DELETE\s+ON\s+storage\.objects\s+TO\s+anon,\s*project_admin/i
    );
    expect(sql).not.toMatch(/GRANT\s+SELECT\s+ON\s+storage\.buckets/i);
  });

  it('runs after migration 043', () => {
    const migrations = fs
      .readdirSync(migrationDir)
      .filter((file) => file.endsWith('.sql'))
      .sort();

    expect(migrations.indexOf('044_prefer-request-jwt-claims.sql')).toBeGreaterThan(
      migrations.indexOf('043_drop-deprecated-ai-configs-and-usage.sql')
    );
  });

  it('keeps dotted jwt claims confined to immutable historical migrations', () => {
    const scannedFiles = readRepoFiles(
      [
        'backend/src',
        'backend/tests',
        'docs',
        'packages',
        'openapi',
        '.agents',
        '.codex',
        '.claude',
      ],
      ['.ts', '.tsx', '.js', '.jsx', '.sql', '.md', '.mdx', '.sh', '.json']
    );

    const offenders = scannedFiles
      .filter(({ content }) => /request\.jwt\.claim\./i.test(content))
      .map(({ path: filePath }) => filePath)
      .filter((filePath) => !historicalDottedClaimMigrations.has(filePath));

    expect(offenders).toEqual([]);
  });

  it('does not reference the removed db user-context service path', () => {
    const scannedFiles = readRepoFiles(
      ['backend/src', 'backend/tests', '.agents', '.codex', '.claude'],
      ['.ts', '.tsx', '.js', '.jsx', '.md', '.mdx']
    );

    const offenders = scannedFiles
      .filter(({ content }) => /services\/db\/user-context/i.test(content))
      .map(({ path: filePath }) => filePath);

    expect(offenders).toEqual([]);
  });

  it('does not reference the removed admin/database context abstraction', () => {
    const scannedFiles = readRepoFiles(
      [
        'backend/src',
        'backend/tests',
        'docs',
        'packages',
        'openapi',
        '.agents',
        '.codex',
        '.claude',
      ],
      ['.ts', '.tsx', '.js', '.jsx', '.sql', '.md', '.mdx', '.sh', '.json']
    );
    const removedContextPattern = new RegExp(
      [
        ['ADMIN', 'DATABASE', 'CONTEXT'].join('_'),
        ['Database', 'Context'].join(''),
        ['with', 'Database', 'Context'].join(''),
      ].join('|'),
      'i'
    );

    const offenders = scannedFiles
      .filter(({ content }) => removedContextPattern.test(content))
      .map(({ path: filePath }) => filePath);

    expect(offenders).toEqual([]);
  });
});
