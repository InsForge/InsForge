/**
 * Detects migration files that share the same numeric prefix.
 *
 * node-pg-migrate orders migrations by their leading number, so two files with
 * the same prefix (e.g. `047_a.sql` and `047_b.sql`) have an ambiguous order and
 * can apply inconsistently across environments. This guard runs in CI (and as a
 * unit test) to stop new duplicates from landing on main.
 *
 * A small set of historical duplicates already exists on main and is grandfathered
 * in via ALLOWED_DUPLICATES — those are tolerated, anything new is rejected.
 *
 * Exports `findDuplicateMigrations()` for the test suite; runs as a CLI (exit 1 on
 * new duplicates) when executed directly.
 */
/* global console, process */
import { readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));

export const MIGRATIONS_DIR = join(__dirname, '..', 'src', 'infra', 'database', 'migrations');

// Pre-existing duplicate prefixes on main. Do not add to this list — fix the
// duplicate instead. These remain only because the migrations already shipped.
export const ALLOWED_DUPLICATES = new Set(['033', '047']);

const MIGRATION_FILE = /^(\d+)_.*\.sql$/;

/**
 * @param {string} [dir] migrations directory to scan
 * @returns {{ count: number, newDuplicates: Array<{prefix:string, files:string[]}>,
 *             grandfathered: Array<{prefix:string, files:string[]}>, nextPrefix: string }}
 */
export function findDuplicateMigrations(dir = MIGRATIONS_DIR) {
  const byPrefix = new Map();

  for (const name of readdirSync(dir)) {
    const match = MIGRATION_FILE.exec(name);
    if (!match) continue;
    const prefix = match[1];
    if (!byPrefix.has(prefix)) byPrefix.set(prefix, []);
    byPrefix.get(prefix).push(name);
  }

  const newDuplicates = [];
  const grandfathered = [];

  for (const [prefix, files] of byPrefix) {
    if (files.length < 2) continue;
    files.sort();
    (ALLOWED_DUPLICATES.has(prefix) ? grandfathered : newDuplicates).push({ prefix, files });
  }

  const maxPrefix = byPrefix.size
    ? Math.max(...[...byPrefix.keys()].map((p) => parseInt(p, 10)))
    : -1;

  return {
    count: byPrefix.size,
    newDuplicates,
    grandfathered,
    nextPrefix: String(maxPrefix + 1).padStart(3, '0'),
  };
}

function main() {
  const { count, newDuplicates, grandfathered, nextPrefix } = findDuplicateMigrations();

  if (grandfathered.length > 0) {
    console.log('Known (grandfathered) duplicate migration prefixes:');
    for (const { prefix, files } of grandfathered) {
      console.log(`  ${prefix}: ${files.join(', ')}`);
    }
  }

  if (newDuplicates.length > 0) {
    console.error('\nERROR: duplicate migration number(s) detected:');
    for (const { prefix, files } of newDuplicates) {
      console.error(`  ${prefix}: ${files.join(', ')}`);
    }
    console.error(
      `\nEach migration needs a unique number. Renumber the new file to the next ` +
        `available prefix (currently ${nextPrefix}_).`
    );
    process.exit(1);
  }

  console.log(`\nOK: ${count} unique migration number(s), no new duplicates.`);
}

// Run as a CLI only when executed directly, not when imported by tests.
if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  main();
}
