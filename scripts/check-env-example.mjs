#!/usr/bin/env node
// Every ${VAR} a compose file reads must appear in .env.example, commented or not.
// There is one .env.example for the whole repo; this is what keeps it that way.
import { readFileSync } from 'node:fs';

const COMPOSE = [
  'docker-compose.yml',
  'docker-compose.prod.yml',
  'docker-compose.dokploy.yml',
  'docker-compose.minio.yml',
  'docker-compose.rustfs.yml',
  'deploy/docker-compose/docker-compose.yml',
];

const declared = new Set(
  [...readFileSync('.env.example', 'utf8').matchAll(/^#?\s*([A-Z][A-Z0-9_]*)=/gm)].map(
    (m) => m[1],
  ),
);

let failed = false;
for (const file of COMPOSE) {
  const used = new Set(
    [...readFileSync(file, 'utf8').matchAll(/\$\{([A-Z][A-Z0-9_]*)/g)].map((m) => m[1]),
  );
  const missing = [...used].filter((v) => !declared.has(v)).sort();
  if (missing.length) {
    failed = true;
    console.error(`${file}: not documented in .env.example — ${missing.join(', ')}`);
  }
}

if (failed) {
  console.error('\nAdd the variables above to .env.example (a commented line is fine).');
  process.exit(1);
}
console.log(`.env.example covers every variable in ${COMPOSE.length} compose files.`);
