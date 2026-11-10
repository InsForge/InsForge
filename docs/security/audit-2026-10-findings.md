# Security Audit Findings — October 2026

Independent source-code review of the self-hosted deployment path (backend,
Docker Compose files, Deno functions runtime). Positive findings first: the
application code itself is in good shape — parameterized SQL throughout,
validated identifier quoting, AES-256-GCM secret encryption, pinned JWT
algorithms, timing-safe comparisons, path-traversal defenses in storage,
SigV4 verification in the S3 gateway, and signature checks on all webhooks.
No SQL injection or path traversal was found.

The material risks are in **deployment defaults** — what ships when an
operator runs the compose files without editing them.

## Findings

| # | Severity | Finding | Status in this PR |
|---|----------|---------|-------------------|
| 1 | Critical | Known-default `JWT_SECRET` (`dev-secret-please-change-in-production`) accepted silently in dev *and* prod compose; shared with PostgREST, Deno, and the Postgres encryption key; also decrypts the secret store via the `ENCRYPTION_KEY` fallback | **Fixed** — startup refuses publicly-known secrets; prod compose requires `JWT_SECRET` (`:?`) |
| 2 | High | Admin login (`POST /api/auth/admin/sessions`) has no rate limiter or lockout, while the *user* login does; default admin password is `change-this-password` | **Partly fixed** — rate limiter added; default password now logs a loud warning (fatal on the known JWT default already covers the worst case) |
| 3 | High | Edge functions receive **every** decrypted secret from `system.secrets` (admin API key, JWT private key, OAuth secrets) — one compromised function = full instance takeover | Proposed (needs design: per-function secret bindings + reserved-key deny-list) |
| 4 | High | Dev compose publishes Postgres (superuser, default password `postgres`), PostgREST, and the Deno runtime on all interfaces | **Fixed** — loopback-only bindings |
| 5 | Medium | CORS `origin: true` + `credentials: true` + `SameSite=None` cookies — safe today only because refresh endpoints check CSRF tokens; fragile against future cookie-authenticated endpoints | Proposed (operator-configured origin allowlist) |
| 6 | Medium | Unauthenticated, unthrottled `/functions/:slug`; each invocation opens two fresh Postgres connections and a 60s worker — cheap anonymous DoS | Proposed |
| 7 | Medium | `db-init.sql` grants full DML on all public tables to `anon`; RLS is opt-in, so new tables without RLS are fully public (advisor warns, but advisory only) | Proposed (default-deny option) |
| 8 | Low | Self-hosted instances fetch rate-limit policy from `config.insforge.dev` and emit telemetry by default | Documented |

## Changes in this PR

1. **`backend/src/utils/secret-validation.ts` (new)** — `assertNoDefaultSecrets()`
   throws at startup when `JWT_SECRET` is a publicly-known default (exit before
   the listener opens). Short-but-unique secrets and the default admin password
   produce loud warnings. Escape hatch for CI/sandboxes:
   `INSFORGE_ALLOW_DEFAULT_SECRETS=1`.
2. **`backend/src/server.ts`** — calls the guard first thing in
   `initializeServer()`.
3. **`backend/src/api/middlewares/rate-limiters.ts`** — new
   `adminLoginRateLimiter` (5 attempts / 15 min / IP, counting all attempts).
4. **`backend/src/api/routes/auth/admin.routes.ts`** — applied to both
   `/sessions` and `/sessions/exchange`.
5. **`docker-compose.yml`** — Postgres, PostgREST, Deno ports bound to
   `127.0.0.1`.
6. **`docker-compose.prod.yml`** — `JWT_SECRET` and `ROOT_ADMIN_PASSWORD` are
   now required (`:?`) instead of falling back to publicly-known defaults.

### Operator migration note

Deployments that relied on the defaults will now fail fast with instructions
(`openssl rand -hex 32`). That is deliberate: the previous behavior silently
ran with a secret published in this repository. Rotating `JWT_SECRET` also
requires setting a dedicated `ENCRYPTION_KEY` beforehand, or previously
stored secrets become undecryptable — the startup warning covers this, and
the env example already documents it.
