# Compute Dashboard UX Fixes

**Date:** 2026-04-07
**Status:** Draft
**Branch:** feat/compute-services

## Context

The Compute Services feature has a complete backend API and CLI, but the dashboard UI is read-only — users can see services but can't manage them. Primary users are agents (CLI/API); the dashboard serves as a monitoring/visibility layer.

## Goals

1. Add action buttons (stop/start/delete) to detail view and card dropdown menus
2. Add a "Create Service" dialog for basic service creation from the UI
3. Add a logs panel in the detail view
4. Show error state info on failed services
5. Fix endpoint URL to show the real `.fly.dev` URL
6. Add missing metadata (region, timestamps) to detail view

## Non-Goals

- Full redesign of page layout (keeping existing card grid + detail view)
- Env var editing UI (use CLI for that)
- Real-time log streaming (polling/manual refresh is fine)

## Design

### 1. Detail View — Action Buttons

Add a button row next to the service name heading:

- **Stop** button (visible when status is `running`) — calls `stop` mutation
- **Start** button (visible when status is `stopped`) — calls `start` mutation
- **Delete** button (always visible) — opens ConfirmDialog, calls `remove` mutation
- Buttons are disabled during pending mutations (loading spinners)
- After delete succeeds, navigate back to list view

Uses: `Button` and `ConfirmDialog` from `@insforge/ui`.

### 2. Detail View — Logs Panel

Below the specs card, add a logs section:

- Fetches logs via `computeServicesApi.logs(id, 50)` using a `useQuery` with manual refetch
- Displays as a scrollable monospace block with timestamps
- "Refresh" button to re-fetch
- Empty state: "No logs available"
- Only shown when `flyMachineId` exists (no logs for services that never deployed)

New component: `ServiceLogs.tsx`

> **Known limitation (v1):** the `/logs` endpoint currently returns Fly machine
> **lifecycle events** from `/apps/:app/machines/:id/events` (start/stop/restart/
> exit), **not container stdout/stderr**. This is enough to spot crash loops via
> exit-stopped events but not enough to debug what the app actually printed.
>
> **Real container stdout/stderr is roadmap work.** Three viable paths,
> evaluated [in this thread](https://github.com/InsForge/InsForge/pull/1062#discussion):
>
> | Path | Where flyctl spawns | Token source | Notes |
> |---|---|---|---|
> | A. Cloud-backend spawns `flyctl logs --no-tail -j` | cloud-backend host | org token in cloud's `process.env` | Token never leaves cloud. ~150 lines + tests. Mirrors existing `flyctl tokens attenuate` pattern in `defaultAttenuator`. |
> | B. Per-app read-logs macaroon, OSS spawns | user's host | short-lived macaroon minted by cloud (mirrors `compute deploy-token`) | Adds flyctl dep on user laptops + token storage/rotation. ~230 lines + ops burden. |
> | C. NATS streaming directly | OSS or cloud-backend | org token | What `flyctl logs` uses internally. Most "correct" but largest surface. |
>
> Recommendation when this lands: start with A (smallest delta, reuses
> existing flyctl shell-out infra). Until then, the misleading `/logs` URL
> stays — alternative is to rename to `/events` to be honest, then add
> `/container-logs` later. v1 keeps `/logs` for compatibility with the
> already-shipped CLI command and dashboard panel.

### 3. Detail View — Enhanced Specs

Add to the existing specs grid:
- Region
- Created at (formatted timestamp)
- Updated at (formatted timestamp)

For failed services: show a red alert banner above the specs card saying "This service failed to deploy" with a Delete button.

### 4. Service Cards — Dropdown Menu

Add a three-dot `DropdownMenu` (from `@insforge/ui`) in the top-right of each card:

- Stop (when running)
- Start (when stopped)
- Delete (always, with confirm)

`onClick` stops propagation so the card click (navigate to detail) still works.

### 5. List Header — Create Button

Add a `+ Create Service` button next to the "Services" heading.

Opens a `Dialog` with form fields:
- Name (text input, required)
- Image URL (text input, required)
- Port (number input, default 8080)
- CPU tier (Select: shared-1x, shared-2x, performance-1x, etc.)
- Memory (Select: 256, 512, 1024, 2048, 4096, 8192)
- Region (Select: iad, sin, lax, etc.)

Calls `create` mutation on submit. Dialog closes on success.

New component: `CreateServiceDialog.tsx`

### 6. Endpoint URL Fix

In both `ServiceCard` and `ComputePage` detail view:
- If `endpointUrl` contains a custom domain but `flyAppId` exists, show `https://{flyAppId}.fly.dev` instead
- Helper function: `getReachableUrl(service)` in `constants.ts`

## Files

| File | Action | What |
|------|--------|------|
| `ComputePage.tsx` | Modify | Add create button, action buttons, logs, enhanced specs, failed state |
| `ServiceCard.tsx` | Modify | Add dropdown menu, use `getReachableUrl` |
| `useComputeServices.ts` | Modify | Add `useLogs` query hook export |
| `constants.ts` | Modify | Add `getReachableUrl` helper |
| `CreateServiceDialog.tsx` | New | Create service form dialog |
| `ServiceLogs.tsx` | New | Logs display component |

## Dependencies

All UI components needed already exist in `@insforge/ui`:
- Button, Dialog, DialogContent, DialogTitle, DialogDescription
- ConfirmDialog
- DropdownMenu
- Input, Select

All API methods already exist in `compute.service.ts`.
All mutations already exist in `useComputeServices` hook.
