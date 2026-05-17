# Database Advisor - Agent Documentation

Run the database advisor after schema migrations or policy changes to catch common security, performance, and health regressions.

## MCP Tool

Use the `advisor.scan` MCP tool when it is available. It should run the same backend scan as:

```http
POST /api/advisor/scan
```

The tool returns a scan result with `summary`, `findings`, and `errors`.

## REST Fallback

If the MCP tool is not available in the current client, call the admin API directly:

```bash
curl -X POST "$INSFORGE_URL/api/advisor/scan" \
  -H "Authorization: Bearer $ADMIN_TOKEN"
```

Fetch the last result without starting a new scan:

```http
GET /api/advisor/latest
```

Fetch filtered findings from the latest scan:

```http
GET /api/advisor/issues?category=security&severity=critical
```

## Agent Workflow

1. Apply the database migration or SQL change.
2. Run `advisor.scan`.
3. Review `findings`.
4. Fix critical security findings before continuing.
5. Re-run the scan after fixes.

## Rule Categories

- Security: RLS, dangerous functions, and policy coverage.
- Performance: foreign key indexes, slow queries, connection pressure, cache ratio, long-running queries, and RLS policy performance.
- Health: dead tuples, stale statistics, sequence exhaustion, and blocked autovacuum.
