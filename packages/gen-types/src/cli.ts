#!/usr/bin/env node
import { writeFileSync } from 'node:fs';
import { genTypes } from './index.js';

const USAGE = `insforge-gen-types — generate TypeScript types from a live Postgres schema

Usage:
  insforge-gen-types [options]

Options:
  --postgres-url <url>   Postgres connection string to introspect
  --local                Use the local Docker stack ($DATABASE_URL or localhost default)
  --schema <list>        Comma-separated schemas to emit (default: public)
  -o, --output <file>    Write to a file instead of stdout
  -h, --help             Show this help

Examples:
  insforge-gen-types --local --schema public > types/database.ts
  insforge-gen-types --postgres-url postgres://user:pass@host:5432/db -o types/database.ts
`;

const LOCAL_DEFAULT_URL = 'postgres://postgres:postgres@localhost:5432/postgres';

interface ParsedArgs {
  postgresUrl?: string;
  local: boolean;
  schemas: string[];
  output?: string;
  help: boolean;
}

function parseArgs(argv: string[]): ParsedArgs {
  const args: ParsedArgs = { local: false, schemas: ['public'], help: false };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    switch (arg) {
      case '--postgres-url':
        args.postgresUrl = argv[++i];
        break;
      case '--local':
        args.local = true;
        break;
      case '--schema':
        args.schemas = (argv[++i] ?? '')
          .split(',')
          .map((s) => s.trim())
          .filter(Boolean);
        break;
      case '-o':
      case '--output':
        args.output = argv[++i];
        break;
      case '-h':
      case '--help':
        args.help = true;
        break;
      default:
        throw new Error(`Unknown argument: ${arg}`);
    }
  }
  return args;
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));

  if (args.help) {
    process.stdout.write(USAGE);
    return;
  }

  const connectionString =
    args.postgresUrl ?? (args.local ? (process.env.DATABASE_URL ?? LOCAL_DEFAULT_URL) : undefined);

  if (!connectionString) {
    throw new Error('Provide a connection: --postgres-url <url> or --local');
  }
  if (args.schemas.length === 0) {
    throw new Error('--schema must list at least one schema');
  }

  const output = await genTypes({ connectionString, schemas: args.schemas });

  if (args.output) {
    writeFileSync(args.output, output);
    process.stderr.write(`Wrote ${args.schemas.join(', ')} types to ${args.output}\n`);
  } else {
    process.stdout.write(output);
  }
}

main().catch((error: unknown) => {
  process.stderr.write(`error: ${error instanceof Error ? error.message : String(error)}\n`);
  process.exit(1);
});
