# PgBouncer Connection Pooler

## Overview

InsForge uses [PgBouncer](https://www.pgbouncer.org/) as a lightweight connection pooler between the application layer and PostgreSQL. Instead of every request opening a new Postgres connection (expensive: TCP handshake, auth, memory allocation), PgBouncer maintains a pool of reusable connections that are shared across all incoming requests.

## Why Connection Pooling Matters

**Without PgBouncer:**
```
Request 1 --> Open connection --> Postgres (holds ~5-10MB RAM)
Request 2 --> Open connection --> Postgres (holds ~5-10MB RAM)
...
Request 500 --> Open connection --> Postgres CRASHES (out of memory/connections)
```

**With PgBouncer:**
```
Request 1 --|
Request 2 --|
...         |--> PgBouncer (20 pooled connections) --> Postgres (stable, low memory)
Request 500 |
```

Each Postgres connection costs ~5-10MB of RAM. Postgres performance degrades significantly beyond ~100 concurrent connections and can crash at ~500. PgBouncer solves this by multiplexing thousands of client connections over a small, fixed pool of real Postgres connections.

## Architecture

```
                                    +------------------+
                                    |                  |
                              +---->|    PostgreSQL     |<----+
                              |     |   (port 5432)    |     |
                              |     +------------------+     |
                              |              ^               |
                              |              |               |
                     +--------+-------+      |        +------+------+
                     |                |      |        |             |
                     |   PgBouncer    |      |        |  PostgREST  |
                     |  (port 5432)   |      |        |  (direct)   |
                     +--------+-------+      |        +------+------+
                              ^              |
                              |              |
              +---------------+-------+      |
              |               |       |      |
        +-----+----+  +------+--+  +-+------+---+
        |          |  |         |  |             |
        | Backend  |  |  Deno   |  |  Realtime   |
        | (pooled) |  | (pooled)|  | (direct)    |
        +----------+  +---------+  +-------------+
```

### Connection Routing

| Service | Connects To | Why |
|---------|------------|-----|
| **Backend (insforge)** | PgBouncer | All API queries use pooled connections for efficiency |
| **Deno (edge functions)** | PgBouncer | Short-lived function queries benefit from pooling |
| **PostgREST** | Postgres (direct) | Requires LISTEN/NOTIFY for automatic schema reload |
| **Realtime (WebSocket)** | Postgres (direct) | Uses LISTEN for real-time event streaming |
| **Migrations (node-pg-migrate)** | Postgres (direct) | Advisory locks are session-level, incompatible with transaction pooling |

## How Transaction Pooling Works

PgBouncer runs in **transaction pooling mode**. Here's what that means:

1. PgBouncer maintains a pool of 20 open connections to Postgres (configurable).
2. When the backend needs to run a query, it asks PgBouncer for a connection.
3. PgBouncer assigns an idle connection from the pool.
4. The backend runs its query/transaction.
5. When the transaction completes, PgBouncer returns the connection to the pool.
6. The next request reuses that same connection.

A single pooled connection can serve hundreds of sequential requests per second because each request only holds it for a few milliseconds.

### What Works Through PgBouncer (Transaction Mode)

- Regular queries (SELECT, INSERT, UPDATE, DELETE)
- Transactions (BEGIN ... COMMIT)
- NOTIFY (sending notifications)
- Temporary tables (within a single transaction)

### What Does NOT Work Through PgBouncer (Transaction Mode)

- **LISTEN** -- requires a persistent, session-level connection
- **Advisory locks** -- session-level locks are released when PgBouncer reassigns the connection
- **Prepared statements** -- bound to a session, lost on reassignment
- **SET** commands -- session-level settings don't persist across transactions

This is why the Realtime service and migrations use direct Postgres connections.

## Configuration

### Environment Variables

Set these in your `.env` file to tune PgBouncer:

| Variable | Default | Description |
|----------|---------|-------------|
| `PGBOUNCER_DEFAULT_POOL_SIZE` | `20` | Number of server connections per database. This is how many concurrent Postgres connections PgBouncer maintains. |
| `PGBOUNCER_MAX_CLIENT_CONN` | `100` | Maximum number of client connections PgBouncer will accept. Requests beyond this limit are rejected. |
| `PGBOUNCER_MAX_DB_CONNECTIONS` | `0` | Hard cap on connections to Postgres. `0` = unlimited (bounded by pool size). |
| `PGBOUNCER_QUERY_WAIT_TIMEOUT` | `120` | Seconds a query waits for a free connection before returning an error. |

### Direct Connection Variables

These are used internally by services that bypass PgBouncer:

| Variable | Default | Used By |
|----------|---------|---------|
| `POSTGRES_DIRECT_HOST` | `postgres` | Realtime LISTEN, migrations |
| `POSTGRES_DIRECT_PORT` | `5432` | Realtime LISTEN, migrations |

### Tuning Guidelines

**Small deployments (< 50 concurrent users):**
```
PGBOUNCER_DEFAULT_POOL_SIZE=10
PGBOUNCER_MAX_CLIENT_CONN=50
```

**Medium deployments (50-500 concurrent users):**
```
PGBOUNCER_DEFAULT_POOL_SIZE=20
PGBOUNCER_MAX_CLIENT_CONN=200
```

**Large deployments (500+ concurrent users):**
```
PGBOUNCER_DEFAULT_POOL_SIZE=50
PGBOUNCER_MAX_CLIENT_CONN=500
```

Rule of thumb: `DEFAULT_POOL_SIZE` should stay under your Postgres `max_connections` (default: 100) minus connections used by PostgREST and direct clients (~10). So keep it at 50 or below for default Postgres settings.

## Files Changed

### Docker Compose (all 4 files)

- `docker-compose.yml` (dev)
- `docker-compose.prod.yml` (production)
- `docker-compose.dokploy.yml` (Dokploy deployment)
- `deploy/docker-compose/docker-compose.yml` (standalone deploy)

Changes in each:

1. **Added `pgbouncer` service** -- `edoburu/pgbouncer:latest`, depends on `postgres` being healthy, with its own healthcheck.
2. **Routed `insforge` service through PgBouncer** -- `POSTGRES_HOST=pgbouncer`, `DATABASE_URL` points to `pgbouncer:5432`. Added `POSTGRES_DIRECT_HOST` and `POSTGRES_DIRECT_PORT` for direct access.
3. **Routed `deno` service through PgBouncer** -- `POSTGRES_HOST=pgbouncer`, depends on `pgbouncer` instead of `postgres`.
4. **PostgREST stays direct** -- still connects to `postgres:5432` for LISTEN/NOTIFY schema reload.

### Backend Code

**`backend/src/infra/database/database.manager.ts`**

- `getPool()` -- connects via `POSTGRES_HOST` (PgBouncer) for all regular queries.
- `createClient()` -- connects via `POSTGRES_DIRECT_HOST` (Postgres) for LISTEN/NOTIFY operations. Falls back to `POSTGRES_HOST` if direct vars are not set.

### Dockerfile

- Migration step in `CMD` overrides `DATABASE_URL` to use `POSTGRES_DIRECT_HOST` so that `node-pg-migrate` advisory locks work correctly against Postgres directly.

### .env.example

- Added `PGBOUNCER_DEFAULT_POOL_SIZE`, `PGBOUNCER_MAX_CLIENT_CONN`, `PGBOUNCER_MAX_DB_CONNECTIONS`, and `PGBOUNCER_QUERY_WAIT_TIMEOUT` with documentation.

## End-to-End Request Flow

Here's what happens when an API request hits InsForge:

```
1. HTTP request arrives at the backend (port 7130)

2. Backend handler calls DatabaseManager.getPool().connect()
   --> This asks the Node.js `pg` Pool for a connection
   --> The Pool connects to pgbouncer:5432 (not Postgres directly)

3. PgBouncer receives the connection request
   --> Authenticates using scram-sha-256
   --> Assigns an idle Postgres connection from its pool
   --> If none are idle, the request waits (up to query_wait_timeout)

4. Query executes on the real Postgres connection

5. Response returns through PgBouncer to the backend

6. Backend calls client.release()
   --> Node.js Pool returns the client to its local pool
   --> PgBouncer marks the Postgres connection as idle and available
   --> The same Postgres connection is now ready for the next request

7. HTTP response sent to the client
```

For Realtime (WebSocket) events:

```
1. RealtimeManager calls DatabaseManager.createClient()
   --> Creates a direct connection to postgres:5432 (bypasses PgBouncer)

2. Client sends LISTEN realtime_message
   --> This is a persistent, session-level operation
   --> The connection stays open for the lifetime of the server

3. When a database trigger fires NOTIFY realtime_message
   --> Postgres delivers the notification to the listening client
   --> RealtimeManager broadcasts it to connected WebSocket clients
```

## Troubleshooting

**"connection refused" from PgBouncer:**
- Check that Postgres is healthy: `docker compose ps postgres`
- Check PgBouncer logs: `docker compose logs pgbouncer`

**"too many clients" error:**
- Increase `PGBOUNCER_MAX_CLIENT_CONN` in your `.env`
- Check for connection leaks (unreleased pool clients in backend code)

**Slow queries / timeouts:**
- Increase `PGBOUNCER_DEFAULT_POOL_SIZE` if queries are waiting for connections
- Check `PGBOUNCER_QUERY_WAIT_TIMEOUT` -- default 120s should be sufficient

**Migrations fail with lock errors:**
- Verify `POSTGRES_DIRECT_HOST` and `POSTGRES_DIRECT_PORT` are set in your compose file
- Migrations must bypass PgBouncer (advisory locks are session-level)

**LISTEN/NOTIFY not working (Realtime broken):**
- Verify `POSTGRES_DIRECT_HOST` is set -- Realtime's `createClient()` uses it
- LISTEN does not work through PgBouncer in transaction mode
