# @insforge/gen-types

Generate TypeScript types from a live InsForge / Postgres schema — the InsForge
equivalent of `supabase gen types typescript`.

Introspects a database and emits a single deterministic `Database` module
typing every table, view, enum, function (RPC) and composite type.

## CLI

```bash
npx insforge-gen-types --postgres-url postgres://user:pass@host:5432/db \
  --schema public -o types/database.ts

# local Docker stack ($DATABASE_URL, falling back to localhost)
npx insforge-gen-types --local -o types/database.ts
```

| Flag | Description |
| ---- | ----------- |
| `--postgres-url <url>` | Postgres connection string to introspect |
| `--local` | Use `$DATABASE_URL` or `postgres://postgres:postgres@localhost:5432/postgres` |
| `--schema <list>` | Comma-separated schemas (default: `public`) |
| `-o, --output <file>` | Write to a file instead of stdout |
| `-h, --help` | Show help |

## Programmatic API

```ts
import { genTypes } from '@insforge/gen-types';

const source = await genTypes({
  connectionString: 'postgres://user:pass@host:5432/db',
  schemas: ['public'],
});
```

Lower-level `introspect()` and `format()` are also exported.

## Notes

- Output is alphabetically sorted — re-runs are byte-identical when the schema
  is unchanged.
- `--linked` / `--project-id` are not yet supported; they depend on
  `insforge link` (tracked in #1129).
- See [docs/core-concepts/database/type-generation](../../docs/core-concepts/database/type-generation.mdx)
  for the full guide.
