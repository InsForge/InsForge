/**
 * Query parameters forwarded verbatim to PostgREST.
 *
 * Express parses `?age=gte.18&age=lte.30` into `{ age: ['gte.18', 'lte.30'] }`.
 * Axios' default serializer writes such an array in bracket form
 * (`age[]=gte.18&age[]=lte.30`), which PostgREST reads as a column named
 * `age[]`, so a range filter silently stops applying. Repeating the key keeps
 * both filters on the real column.
 */
export type PostgrestQueryParams = Record<string, unknown>;

export function serializePostgrestParams(params: PostgrestQueryParams | undefined): string {
  const search = new URLSearchParams();

  for (const [key, rawValue] of Object.entries(params ?? {})) {
    if (rawValue === undefined || rawValue === null) continue;

    const values = Array.isArray(rawValue) ? rawValue : [rawValue];
    for (const value of values) {
      if (value === undefined || value === null) continue;
      // Express hands us strings for `?a=1&a=2`; anything else is JSON-encoded
      // the way the upstream expects from a query parser.
      search.append(key, typeof value === 'string' ? value : JSON.stringify(value));
    }
  }

  return search.toString();
}
