import { spawnSync } from 'node:child_process';
import { basename, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const rootDir = dirname(dirname(fileURLToPath(import.meta.url)));
const backendDir = join(rootDir, 'backend');
const npmCommand = process.platform === 'win32' ? 'npm.cmd' : 'npm';

function run(command, args, options = {}) {
  const { allowFailure = false, capture = false, cwd = rootDir } = options;
  const result = spawnSync(command, args, {
    cwd,
    env: process.env,
    encoding: 'utf8',
    stdio: capture ? 'pipe' : 'inherit',
  });

  if (result.error && !allowFailure) {
    throw result.error;
  }

  if ((result.status ?? 1) !== 0 && !allowFailure) {
    const printable = [command, ...args].join(' ');
    throw new Error(`Command failed (${result.status}): ${printable}`);
  }

  return result;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function getProjectName() {
  if (process.env.COMPOSE_PROJECT_NAME) {
    return process.env.COMPOSE_PROJECT_NAME;
  }

  return basename(rootDir)
    .toLowerCase()
    .replace(/[^a-z0-9_-]/g, '');
}

async function waitForPostgres() {
  const user = process.env.POSTGRES_USER || 'postgres';
  const database = process.env.POSTGRES_DB || 'insforge';
  const maxAttempts = 30;

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    const result = run(
      'docker',
      ['compose', 'exec', '-T', 'postgres', 'pg_isready', '-U', user, '-d', database],
      { allowFailure: true, capture: true }
    );

    if (result.status === 0) {
      console.log('Postgres is ready.');
      return;
    }

    if (attempt === maxAttempts) {
      const stderr = result.stderr?.trim();
      throw new Error(
        `Postgres did not become ready after ${maxAttempts} attempts${stderr ? `: ${stderr}` : '.'}`
      );
    }

    console.log(`Waiting for Postgres to become ready (${attempt}/${maxAttempts})...`);
    await sleep(2000);
  }
}

const projectName = getProjectName();

console.log('Stopping services that depend on Postgres...');
run('docker', ['compose', 'stop', 'insforge', 'postgrest', 'deno', 'postgres'], {
  allowFailure: true,
  capture: true,
});
run('docker', ['compose', 'rm', '-f', '-s', 'postgres'], {
  allowFailure: true,
  capture: true,
});

const volumes = run(
  'docker',
  [
    'volume',
    'ls',
    '-q',
    '--filter',
    `label=com.docker.compose.project=${projectName}`,
    '--filter',
    'label=com.docker.compose.volume=postgres-data',
  ],
  { capture: true }
).stdout.trim();
const postgresVolume = volumes.split('\n').find(Boolean);

if (postgresVolume) {
  console.log(`Removing Postgres volume: ${postgresVolume}`);
  run('docker', ['volume', 'rm', postgresVolume]);
} else {
  console.log('No existing Postgres volume found.');
}

console.log('Starting Postgres and PostgREST...');
run('docker', ['compose', 'up', '-d', 'postgres', 'postgrest']);

await waitForPostgres();

console.log('Running migrations and seed data...');
run(npmCommand, ['run', 'migrate:up:local'], { cwd: backendDir });
run(npmCommand, ['run', 'seed:run'], { cwd: backendDir });

console.log('Database reset complete.');
