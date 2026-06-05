# Compute Container Logs — Design

**Date:** 2026-06-04
**Priority:** Dashboard-first — click into a compute service and see its container stdout/stderr.

## Problem

Compute services (containers on Fly.io) expose only **machine lifecycle events**
(`ServiceEvents` panel / `compute events` — start/stop/exit/restart). There is no way to
see container **stdout/stderr** ("application logs") from the dashboard or CLI. This adds it.

## Verified foundation

Fly exposes an HTTP REST logs endpoint (the same one `flyctl logs` and Fly's dashboard use).
Tested live against a throwaway Fly container on 2026-06-04:

```
GET https://api.fly.io/api/v1/apps/{app}/logs
  Auth:   Authorization: FlyV1 <org-macaroon>        # NOT "Bearer"
  Query:  instance=<machineId>  next_token=<ns-unix-cursor>
  Returns: HTTP 200, data[].attributes { timestamp(RFC3339), message, instance, region }
           + meta.next_token cursor
  History: ~7-day retention (populates the view on open); re-poll with next_token to tail
```

### Gotchas (both load-bearing, both hit during implementation)

1. **Auth scheme.** The existing providers call `api.machines.dev` with `Bearer`. The logs
   endpoint is on `api.fly.io` and **rejects `Bearer` with 401** — it requires the Fly
   macaroon scheme `Authorization: FlyV1 <token>`. Same token, different host + prefix.
2. **`next_token` precision.** It is a nanosecond Unix timestamp that exceeds
   `Number.MAX_SAFE_INTEGER`. `JSON.parse()` silently rounds it and corrupts the cursor, so
   the provider extracts it from the raw response text to preserve every digit.

## Auth boundary (org token never leaves the backend)

```
CLI       ──Bearer ik_<project key>──┐
Dashboard ──user access token────────┤──▶ Backend ──FlyV1 <org token>──▶ Fly
(browser)        (withAccessToken)   ┘     (sole holder of the org token)
```

Neither the CLI nor the dashboard ever holds the Fly org token. The backend authorizes the
request (project ownership), then calls Fly. Identical boundary to the existing `events` route.

## What shipped in this PR (monorepo: `insforge-current-main`)

Mirrors the `events` feature end to end. New surface is one provider method (`getLogs`) feeding
a route, a service method, and the dashboard panel.

- `shared-schemas`: `computeLogLineSchema` / `computeLogsResponseSchema` (+ types).
- `compute.provider.ts`: `ComputeLogLine` / `ComputeLogsResult` + `getLogs()` on the interface.
- `fly.provider.ts`: `getLogs()` — `api.fly.io` + `FlyV1`, `instance` scoping, RFC3339→epoch-ms
  normalization, precision-safe `next_token`. (Self-host path; unit-tested.)
- `cloud.provider.ts`: `getLogs()` — delegates `GET /machines/:id/logs` to the control plane.
- `services.service.ts`: `getServiceLogs()` (ownership guard, mirrors `getServiceEvents`).
- `services.routes.ts`: `GET /:id/logs` (`verifyAdmin`, project-ownership, `limit`, `next_token`).
- Dashboard: `computeServicesApi.logs()`, `useServiceLogs` hook, `ServiceLogs.tsx` (recent on
  open + **Live** toggle re-polling every 2s), mounted in the service detail view beside Events.

Live tail in v1 = re-fetch the recent window on an interval (stateless; no cursor
accumulation/dedup to get wrong). SSE is a possible later upgrade.

## Companion PR (separate repo: `insforge-cloud-backend`)

For InsForge Cloud, the dashboard runs through `CloudComputeProvider`, which delegates to the
cloud control plane. That backend needs the matching `GET …/machines/:id/logs` route (its
own `fly-client.getLogs` with the same `api.fly.io` + `FlyV1` call). **Self-hosted works
fully from this PR alone** (FlyProvider path); cloud needs the companion route to light up.

## Non-goals

- No Vector / log-shipper / NATS / WireGuard. The REST endpoint is sufficient.
- No durable log store / new DB table — relies on Fly's ~7-day retention. A persisted,
  searchable store is a deferred future phase behind the same surfaces, only if needed.
- No CLI in this PR — Phase 2 (`compute logs <id> --follow`), reusing the same route.

## Risks

- **Unofficial endpoint.** Fly documents the logs REST endpoint as "stable but not officially
  supported — flyctl depends on it." Acceptable; the provider degrades to a thrown error (not
  a crash) on non-200, and the durable-store path is the long-term fallback.
