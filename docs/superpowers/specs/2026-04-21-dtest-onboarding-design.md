# D Test Onboarding Design

**Status:** Draft
**Owner:** @CarmenDou
**Date:** 2026-04-21
**Branch:** `feat/support-dtest-onboarding`

## Context

Dashboard currently supports two variants of the home page, switched by the PostHog feature flag `dashboard-v3-experiment`:

- default (`DashboardPage`) — baseline
- `c_test` (`CTestDashboardPage`) — Get-Started + Prompt Stepper + metrics

We are adding a third variant `d_test` to compare a more **install-first** onboarding against C test. D test ships a reworked "Install InsForge" client picker as the pre-connection view, and a simplified post-connection dashboard (header + 4 metric cards, no stepper).

Figma references:
- Install InsForge (client picker): `2194:75236`
- Client detail page (Claude Code example): `2226:78350`
- Connection String detail: `2226:79152`
- Connected dashboard: `2380:89947`

## Goals

1. Let users connect any coding agent (Claude Code, Codex, Antigravity, Cursor, Copilot, Trae, "Other") or connect directly via DB connection string / API keys, from a single discoverable page.
2. Keep the connected-state dashboard minimal: project header + User / Database / Storage / Edge Functions cards.
3. Share underlying install components (`NewCLISection`, `MCPSection`, `ConnectionStringSectionV2`, `APIKeysSectionV2`) with other dashboard variants so the winning variant leaves behind clean, working infrastructure.
4. Allow users to toggle between Install view and Dashboard view freely after first connection.

## Non-Goals

- Changing the install commands themselves (CLI command template, MCP install payloads, DB credentials). D test reuses existing content verbatim.
- Changing onboarding detection logic beyond what `useMcpUsage().hasCompletedOnboarding` already provides.
- Replacing the `ConnectDialog` for the non-`d_test` variants — those keep the existing modal.

## Connected-State Detection

D test treats a user as **connected** when `useMcpUsage().hasCompletedOnboarding` is true. That hook resolves to `!!records.length` where `records` comes from `/mcp-usage?success=true&limit=200`, i.e. the agent has successfully invoked ≥ 1 MCP tool.

This is the same signal C test uses today. No new backend work.

## View Model

Two top-level views, both mounted at `/dashboard` (the existing Dashboard home route), switched by an in-page state `view: 'install' | 'dashboard'`.

### View resolution

`view` is reflected in the URL as `?view=install` (absent = dashboard). That makes refresh preserve state, enables deep-linking, and supports browser back/forward.

When the URL has no `view` param, the initial view is computed once on mount:

```
if installDismissed (localStorage, per-project) → dashboard
else if !hasCompletedOnboarding                 → install
else                                            → dashboard
```

`installDismissed` is persisted in `localStorage` under key `insforge-dtest-install-dismissed-<projectId>`:

- Set to `true` when the user clicks `[X]` on the Install page (the explicit dismissal gesture). Prevents the "auto-bounce back to install after dismissal" refresh bug.
- Also set to `true` the first time `hasCompletedOnboarding` flips to true, so a connected user who later loses MCP usage history does not get bounced to install.

Clicking the top-nav `Connect` button (d_test + on `/dashboard`) sets `?view=install` via `useSearchParams`. It does **not** clear `installDismissed` — the flag only governs the *default* view when no URL param is present. Top-nav Connect is an explicit override that always works.

Within the Install view there is a sub-state `selectedClient`:

```
view = 'install'
   ├── selectedClient === null   →  InstallInsForgePage (All Clients)
   └── selectedClient !== null   →  ClientDetailPage for that client
```

`selectedClient` is **not** reflected in the URL. Opening Install always starts at All Clients. (Rationale: the detail view is always one click away; lifting it to URL adds routing complexity for marginal benefit.)

## Navigation Map

```
┌────────────────────────────┐                     ┌────────────────────────────┐
│   InstallInsForgePage      │  [X] close          │   DTestConnectedDashboard  │
│   (All Clients)            │────────────────────▶│   (header + 4 metrics)     │
│                            │                     │                            │
│                            │◀────────────────────│                            │
└────┬───────────────────────┘  TopNav Connect     └────────────────────────────┘
     │
     │ click tile
     ▼
┌────────────────────────────┐
│   ClientDetailPage         │
│   (← All Clients)          │─── CLI tab ──▶  <NewCLISection />
│                            │
│                            │─── MCP tab ──▶  <MCPSection initialAgentId={id} />
│                            │
│                            │  (or ConnectionStringSectionV2 / APIKeysSectionV2
│                            │   for Direct Connect tiles, no CLI/MCP toggle)
└────────────────────────────┘
```

## Install Page Layout

Three stacked sections, max-width 640 px, top-padding 64 px, centered:

1. **"Setup In Claude Code"** — single tile for Claude Code with `Install` button. (Figma says "OpenClaw"; that is a typo, implement as Claude Code.)
2. **"Install in Coding Agent"** — 2-column × 4-row grid of tiles. Tiles in display order:
   1. Claude Code  &nbsp;|&nbsp; Codex
   2. Antigravity  &nbsp;|&nbsp; Cursor
   3. Copilot      &nbsp;|&nbsp; Trae
   4. Other Agents &nbsp;|&nbsp; *(empty cell)*
3. **"Direct Connect"** — 2 tab-style tiles side by side: Connection String | API Keys. These are visually similar to agent tiles but open different detail content.

Top-right of the page header row (same row as the title, within the max-w-640 column): `[X]` close button → switches view to `'dashboard'` (clears `?view` param) and sets `installDismissed = true` in localStorage.

Title text: "Install InsForge".

## Client Detail Page Layout

Top: `← All Clients` text button (always the same label, regardless of client) → clears `selectedClient`.

Below: 32 px client icon + client display name (h2, 28 px medium).

Content changes per client type:

### Coding agents (Claude Code, Codex, Antigravity, Cursor, Copilot, Trae, Other Agents)

- CLI / MCP toggle (`toggle nav` pattern from Figma).
- **CLI tab** → `<NewCLISection isCTest={false} />` (identical 3-step layout for every agent).
- **MCP tab** → `<MCPSection initialAgentId={id} apiKey={...} appUrl={...} />`.
  - For specific agents, `initialAgentId` matches the tile id (`claude-code`, `codex`, `cursor`, `antigravity`, `copilot`, `trae`).
  - For "Other Agents", `initialAgentId` is omitted; `MCPSection` falls back to its default (`MCP_AGENTS[0]`), keeping the full dropdown usable.
  - User can still change the dropdown in all cases.

### Connection String tile

- No CLI/MCP toggle.
- Content: `<ConnectionStringSectionV2 />`.
- Title: "Connection String", icon: database.

### API Keys tile

- No CLI/MCP toggle.
- Content: `<APIKeysSectionV2 apiKey={...} anonKey={...} appUrl={...} />`.
- Title: "API Keys", icon: key.

## Connected Dashboard Layout

Matches Figma node `2380:89947`. No Prompt Stepper, no backup badge, no floating button.

```
<h1> My Project </h1>  [INSTANCE BADGE]  ● Healthy

┌──────┐ ┌──────┐ ┌──────┐ ┌──────┐
│ User │ │ DB   │ │ Stor │ │ Fns  │
└──────┘ └──────┘ └──────┘ └──────┘
```

Project title, instance-type badge, and health badge follow the same source-of-truth logic that C test uses (`useCloudProjectInfo`, `useMetadata`). Each metric card uses the shared `MetricCard` component (extracted from `CTestDashboardPage`).

## File Plan

### New files

```
packages/dashboard/src/features/dashboard/
├── pages/
│   └── DTestDashboardPage.tsx              # entry; reads view state, dispatches
└── components/
    └── dtest/
        ├── InstallInsForgePage.tsx          # All Clients view (3 sections)
        ├── ClientDetailPage.tsx             # detail shell: back + title + slot
        ├── ClientTile.tsx                   # reusable tile for agents & direct-connect
        ├── DTestConnectedDashboard.tsx      # header + 4 metric cards
        ├── useDTestView.ts                  # URL-backed view state + selectedClient
        └── clientRegistry.ts                # tile metadata (id, label, icon, content type)
```

### Shared components extracted

```
packages/dashboard/src/features/dashboard/components/
└── MetricCard.tsx     # lifted from CTestDashboardPage.tsx (currently an inner function)
```

`CTestDashboardPage.tsx` loses its inner `MetricCard` definition and imports the shared one.

### Modified files

- `packages/dashboard/src/router/AppRoutes.tsx`
  - Add `d_test` branch that renders `DTestDashboardPage`.
- `packages/dashboard/src/features/dashboard/components/connect/MCPSection.tsx`
  - Add optional `initialAgentId?: string` prop.
  - Change `useState` initializer to resolve `MCP_AGENTS.find((a) => a.id === initialAgentId) ?? MCP_AGENTS[0]`.
- `packages/dashboard/src/layout/AppHeader.tsx` (top-nav `Connect` button)
  - When `dashboardVariant === 'd_test'` and current route is `/dashboard`: `onClick` sets `?view=install` via react-router `useSearchParams`, instead of calling `openConnectDialog`.
  - Other variants: no behavior change.

## Client Registry

`clientRegistry.ts` centralizes the tile data so both the grid and the detail routing can look up by id:

```ts
type ClientId =
  | 'claude-code'
  | 'codex'
  | 'antigravity'
  | 'cursor'
  | 'copilot'
  | 'trae'
  | 'other'
  | 'connection-string'
  | 'api-keys';

type ClientEntry = {
  id: ClientId;
  label: string;
  icon: ReactNode;
  kind: 'agent' | 'direct-connect';
  /** MCP dropdown preselection; undefined for 'other' and direct-connect */
  mcpAgentId?: string;
};
```

The "featured" section ("Setup In Claude Code") and grid consume the same entries; only the section they render in differs.

## State Management

One hook, `useDTestView`, owns view resolution, URL sync, and the dismissal flag:

```ts
function useDTestView(hasCompletedOnboarding: boolean, projectId: string | undefined) {
  const [params, setParams] = useSearchParams();
  const dismissKey = `insforge-dtest-install-dismissed-${projectId || 'default'}`;
  const [selectedClient, setSelectedClient] = useState<ClientId | null>(null);

  // resolve view: explicit URL > dismissal > onboarding state
  const view: 'install' | 'dashboard' = useMemo(() => {
    const urlView = params.get('view');
    if (urlView === 'install') return 'install';
    if (urlView === 'dashboard' || urlView === null) {
      if (urlView === 'dashboard') return 'dashboard';
      const dismissed = safeLocalStorage.getItem(dismissKey) === 'true';
      if (dismissed) return 'dashboard';
      return hasCompletedOnboarding ? 'dashboard' : 'install';
    }
    return 'dashboard';
  }, [params, hasCompletedOnboarding, dismissKey]);

  // persist dismissal the first time onboarding completes
  useEffect(() => {
    if (hasCompletedOnboarding && projectId) {
      safeLocalStorage.setItem(dismissKey, 'true');
    }
  }, [hasCompletedOnboarding, projectId, dismissKey]);

  const setView = (v: 'install' | 'dashboard', options?: { dismiss?: boolean }) => {
    const next = new URLSearchParams(params);
    if (v === 'install') next.set('view', 'install');
    else next.delete('view');
    setParams(next, { replace: true });
    if (v === 'dashboard') setSelectedClient(null);
    if (options?.dismiss && projectId) safeLocalStorage.setItem(dismissKey, 'true');
  };

  return { view, setView, selectedClient, setSelectedClient };
}
```

- `[X]` on Install calls `setView('dashboard', { dismiss: true })`.
- Top-nav Connect on d_test calls `setView('install')` (no dismiss mutation; the flag governs defaults, not explicit toggles).
- `selectedClient` is session-local; switching to dashboard clears it.
- `safeLocalStorage` wraps `localStorage` access in try/catch for SSR / privacy-mode safety, matching the pattern `CTestDashboardPage` already uses.

## Feature Flag

PostHog `dashboard-v3-experiment` flag must gain a new variant key `d_test`. This is a PostHog-dashboard-side change and is out of scope for the code PR; document it in the PR description so Carmen can configure it before rollout.

`AppRoutes.tsx`:

```ts
const dashboardVariant = getFeatureFlag('dashboard-v3-experiment');
const DashboardHomePage =
  dashboardVariant === 'c_test' ? CTestDashboardPage :
  dashboardVariant === 'd_test' ? DTestDashboardPage :
  DashboardPage;
```

## Testing

This is a UI-only change; verification is primarily manual through the dev server, with the PostHog override tool used to flip variants.

- For each variant (`default`, `c_test`, `d_test`):
  - Load `/dashboard` with an account that has **no** MCP usage → correct "unconnected" view renders.
  - Load `/dashboard` with an account that has MCP usage → correct "connected" view renders.
- D-test-specific flows:
  - Click each agent tile → detail page renders with the right icon/title, CLI tab shows `NewCLISection`, MCP tab preselects that agent in the dropdown.
  - Click "Other Agents" → MCP dropdown defaults to the first entry, can cycle through all.
  - Click Connection String tile → `ConnectionStringSectionV2` renders inside the detail shell.
  - Click API Keys tile → `APIKeysSectionV2` renders inside the detail shell.
  - `← All Clients` from any detail → back to grid with scroll preserved.
  - `[X]` on Install page → lands on dashboard view; URL has no `view` param; refresh stays on dashboard (dismissal flag persisted).
  - Connect button in top nav (on `d_test`, on `/dashboard`) → returns to Install page; refresh preserves Install (via `?view=install`).
  - Refresh on detail page → returns to Install grid (selectedClient is session-local, not URL-backed). Acceptable per design.
- Cross-variant regression:
  - On `default` / `c_test`, Connect button still opens `ConnectDialog` modal, not Install page.
  - `MCPSection` with no `initialAgentId` still defaults to `MCP_AGENTS[0]` as before.
  - `CTestDashboardPage` metric cards still render (now via shared `MetricCard`).

## Risk & Rollback

- Feature-flagged end-to-end; rollback is a PostHog flag change.
- Shared-component edits (`MCPSection`, extracted `MetricCard`) must remain backward-compatible. `initialAgentId` is optional and defaults to today's behavior; extracted `MetricCard` keeps the same props surface.

## Open Items

- PostHog `d_test` variant configuration (outside code) — needs to be set up before rollout.
