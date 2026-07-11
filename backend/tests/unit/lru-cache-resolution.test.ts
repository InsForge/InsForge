import { describe, test, expect } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

/**
 * Regression guard for the lru-cache dedup fix.
 *
 * backend/src/services/storage/s3-access-key.service.ts does
 * `import { LRUCache } from 'lru-cache'`, which only works on v11 (v11's CJS
 * build exposes `LRUCache` as a named export). @babel/helper-compilation-targets
 * pulls lru-cache@5, whose `module.exports` IS the class and has no named
 * export. If npm hoists babel's v5 to the workspace root, the backend import
 * resolves to `undefined` in any partially-installed checkout -> "LRUCache is
 * not a constructor" (and tsc loses the bundled types). The root `lru-cache`
 * devDependency in the workspace package.json pins v11 to the root hoist slot;
 * these tests fail loudly if that guarantee ever regresses (e.g. the root
 * devDependency is pruned as "unused" or npm's hoisting flips on an upgrade).
 */
describe('lru-cache resolution', () => {
  test('exposes the named LRUCache export as a constructor', async () => {
    const { LRUCache } = await import('lru-cache');
    expect(typeof LRUCache).toBe('function');
    expect(() => new LRUCache<string, string>({ max: 1 })).not.toThrow();
  });

  test('hoists lru-cache v11 (not babel’s v5) to the workspace root', () => {
    const workspaceRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');
    const rootLruCachePkg = resolve(workspaceRoot, 'node_modules/lru-cache/package.json');

    expect(existsSync(rootLruCachePkg)).toBe(true);

    const { version } = JSON.parse(readFileSync(rootLruCachePkg, 'utf8')) as { version: string };
    expect(version.split('.')[0]).toBe('11');
  });
});
