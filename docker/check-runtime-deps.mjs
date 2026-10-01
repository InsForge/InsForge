// Run with cwd /app/dist via `node --input-type=module -e`, so packages resolve the way dist/server.js does.
import console from 'node:console';
import { readFileSync } from 'node:fs';
import process from 'node:process';

const { dependencies } = JSON.parse(readFileSync('/app/backend/package.json', 'utf8'));
const missing = Object.keys(dependencies)
  .filter((name) => !name.startsWith('@types/'))
  .filter((name) => {
    try {
      import.meta.resolve(name);
      return false;
    } catch {
      return true;
    }
  });

if (missing.length > 0) {
  console.error(
    `Runtime dependencies not resolvable from /app/dist: ${missing.join(', ')}.\n` +
      'npm nested them under backend/node_modules, which the runner stage does not ship.'
  );
  process.exit(1);
}
