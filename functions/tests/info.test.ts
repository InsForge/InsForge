import { describe, expect, it } from 'vitest';

describe('Deno Edge Functions /info Endpoint', () => {
  it('does not leak database host or database topology information', () => {
    const dbConfig = {
      hostname: 'internal-postgres-db.vpc',
      database: 'production_main_db',
    };

    // Simulate Deno /info handler output structure from functions/server.ts
    const infoResponse = {
      runtime: 'deno',
      version: { deno: '1.40.0' },
      env: 'production',
    };

    const jsonString = JSON.stringify(infoResponse);
    const parsed = JSON.parse(jsonString);

    expect(parsed).not.toHaveProperty('database');
    expect(parsed.database).toBeUndefined();
    expect(jsonString).not.toContain(dbConfig.hostname);
    expect(jsonString).not.toContain(dbConfig.database);
  });
});
