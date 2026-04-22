# D Test Onboarding Design

**Status:** Draft
**Owner:** @CarmenDou
**Date:** 2026-04-21
**Branch:** `feat/support-dtest-onboarding`

## Context

Dashboard home is gated by a single PostHog feature flag `dashboard-v4-experiment` with three variants:

- default / `control` (`DashboardPage`) — baseline
- `c_test` (`CTestDashboardPage`) — pairs with `ConnectDialogV2` as the top-nav Connect flow
- `d_test` — new **install-first** onboarding introduced in this spec

D test ships a reworked "Install InsForge" client picker as the pre-connection view, and a simplified post-connection dashboard (header + 4 metric cards, no stepper). On d_test the top-nav Connect button does **not** open any dialog — it switches the page back to the Install view so users can re-visit setup at any time.

Figma references:
- Install InsForge (client picker): `2194:75236`
- Client detail page (Claude Code example): `2226:78350`
- Connection String detail: `2226:79152`
- Connected dashboard: `2380:89947`

## Goals

1. Let users connect any coding agent (OpenClaw, Claude Code, Codex, Antigravity, Cursor, OpenCode, Copilot, Cline, "Other") or connect directly via DB connection string / API keys, from a single discoverable page.
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

Two top-level views, both mounted at `/dashboard` (the existing Dashboard home route), switched by an in-page state `view: 'install' | 'dashboard'`. View is **session-local React state** (not URL-backed, not persisted) — simpler than the earlier design and still covers every user-facing transition.

### View resolution

On mount, once `useMcpUsage()` finishes loading, the initial view is:

```text
hasCompletedOnboarding ? 'dashboard' : 'install'
```

Thereafter, the view only changes on two events:

1. **Onboarding completes** (`hasCompletedOnboarding` flips false → true): auto-switch to `'dashboard'`. This is the "MCP call succeeds → jump to dashboard" UX.
2. **Top-nav Connect clicked** (d_test + `/dashboard` route): switch to `'install'`. The Connect button is always enabled; clicking it simply re-opens Install.

On refresh the session state resets. The initial-view rule re-runs, so a connected user lands back on dashboard and an unconnected user lands on install — both are the correct defaults. The transient "I just clicked Connect to peek at install" intent is not persisted; if the user wants Install again, they click Connect again.

Within the Install view there is a sub-state `selectedClient`:

```text
view = 'install'
   ├── selectedClient === null   →  InstallInsForgePage (All Clients)
   └── selectedClient !== null   →  ClientDetailPage for that client
```

`selectedClient` is session-local and resets when switching to dashboard.

## Navigation Map

```text
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

1. **"Setup In OpenClaw"** — single tile for OpenClaw with `Install` button. (OpenClaw is a distinct agent, not a Figma typo for Claude Code; it is registered as its own `MCPAgent` with `id='openclaw'`, uses `@insforge/install --client openclaw`, and is the `FEATURED_OPENCLAW_ID` in `clientRegistry.tsx`.)
2. **"Install in Coding Agent"** — 2-column × 4-row grid of tiles. Tiles in display order:
   1. Claude Code  &nbsp;|&nbsp; Codex
   2. Antigravity  &nbsp;|&nbsp; Cursor
   3. OpenCode     &nbsp;|&nbsp; Copilot
   4. Cline        &nbsp;|&nbsp; Other Agents
3. **"Direct Connect"** — 2 tab-style tiles side by side: Connection String | API Keys. These are visually similar to agent tiles but open different detail content.

Top-right of the page header row (same row as the title, within the max-w-640 column): `[X]` close button → switches view to `'dashboard'` (clears `?view` param) and sets `installDismissed = true` in localStorage.

Title text: "Install InsForge".

## Client Detail Page Layout

Top: `← All Clients` text button (always the same label, regardless of client) → clears `selectedClient`.

Below: 32 px client icon + client display name (h2, 28 px medium).

Content changes per client type:

### Coding agents (OpenClaw, Claude Code, Codex, Antigravity, Cursor, OpenCode, Copilot, Cline, Other Agents)

- CLI / MCP toggle (`toggle nav` pattern from Figma).
- **CLI tab** → `<DTestCLISection agentName={...} />` (identical layout for every agent; prompt uses a static `<placeholder>` for the API key line — see "D Test CLI prompt" below).
- **MCP tab** → `<DTestMCPSection agentId={id} apiKey={...} appUrl={...} />`.
  - For specific agents, `agentId` matches the tile id (`openclaw`, `claude-code`, `codex`, `cursor`, `antigravity`, `opencode`, `copilot`, `cline`).
  - For "Other Agents", the entry sets `mcpAgentId: 'mcp'` which jumps directly to the MCP JSON config (no agent dropdown needed).
  - For Cursor and Qoder (deeplink-capable), Step 1 shows an "Install to &lt;agent&gt;" white button that opens the MCP-install deeplink and Step 2 shows a "Paste Prompt to &lt;agent&gt;" button that copies `MCP_VERIFY_CONNECTION_PROMPT` to the clipboard. Other agents show the terminal command + prompt code blocks.

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

```text
<h1> My Project </h1>  [INSTANCE BADGE]  ● Healthy

┌──────┐ ┌──────┐ ┌──────┐ ┌──────┐
│ User │ │ DB   │ │ Stor │ │ Fns  │
└──────┘ └──────┘ └──────┘ └──────┘
```

Project title, instance-type badge, and health badge follow the same source-of-truth logic that C test uses (`useCloudProjectInfo`, `useMetadata`). Each metric card uses the shared `MetricCard` component (extracted from `CTestDashboardPage`).

## File Plan

### New files

```text
packages/dashboard/src/features/dashboard/
├── pages/
│   └── DTestDashboardPage.tsx              # entry; reads view state, dispatches
└── components/
    └── dtest/
        ├── InstallInsForgePage.tsx          # All Clients view (3 sections)
        ├── ClientDetailPage.tsx             # detail shell: back + title + slot
        ├── ClientTile.tsx                   # reusable tile for agents & direct-connect
        ├── DTestConnectedDashboard.tsx      # header + 4 metric cards
        ├── DTestViewContext.tsx             # React context: view + selectedClient, shared between AppHeader and DTestDashboardPage
        └── clientRegistry.ts                # tile metadata (id, label, icon, content type)
```

### Shared components extracted

```text
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
- `packages/dashboard/src/layout/AppLayout.tsx`
  - Update the dialog-variant flag from `dashboard-v3-experiment` to `dashboard-v4-experiment`. `c_test` still renders `ConnectDialogV2`; `d_test` and default both fall through to `ConnectDialog` (d_test never actually opens it — the Connect button re-routes to the Install view — but the component is still mounted so Connect from non-`/dashboard` routes keeps working).
  - Wrap the layout tree in `DTestViewProvider` so `AppHeader` and `DTestDashboardPage` share view state.
- `packages/dashboard/src/layout/AppHeader.tsx` (top-nav `Connect` button)
  - When `dashboardVariant === 'd_test'` and current route is `/dashboard`: `onClick` calls `setView('install')` from `DTestViewContext` instead of calling `openConnectDialog`.
  - `showConnectTip` checks `dTestView !== 'install'` from the same context (previously read `?view` from URL).
  - Other variants: no behavior change.
- `packages/dashboard/src/lib/contexts/SocketContext.tsx`
  - Rename the `experiment_variant` tag on `onboarding_completed` analytics from `dashboard-v3-experiment` to `dashboard-v4-experiment` so analytics matches the live flag.

## Client Registry

`clientRegistry.ts` centralizes the tile data so both the grid and the detail routing can look up by id:

```ts
type ClientId =
  | 'openclaw'
  | 'claude-code'
  | 'codex'
  | 'antigravity'
  | 'cursor'
  | 'opencode'
  | 'copilot'
  | 'cline'
  | 'other'
  | 'connection-string'
  | 'api-keys';

type ClientEntry = {
  id: ClientId;
  label: string;
  icon: ReactNode;
  kind: 'agent' | 'direct-connect';
  /** MCP detail preselection. Use 'mcp' for "Other Agents"; omit for direct-connect. */
  mcpAgentId?: string;
};
```

`FEATURED_OPENCLAW_ID = 'openclaw'` is the featured tile in Section 1; `CODING_AGENT_GRID_IDS` renders the Section 2 grid starting with `'claude-code'`. The `other` entry sets `mcpAgentId: 'mcp'` so clicking "Other Agents" drops the user straight into the MCP JSON config view.

The "featured" section ("Setup In OpenClaw") and grid consume the same entries; only the section they render in differs.

## State Management

A React context (`DTestViewContext`) provided at `AppLayout` level owns `view` + `selectedClient` and exposes a `useDTestView` hook for both `AppHeader` and `DTestDashboardPage`:

```tsx
export function DTestViewProvider({ children }: { children: ReactNode }) {
  const { hasCompletedOnboarding, isLoading } = useMcpUsage();
  const [selectedClient, setSelectedClient] = useState<ClientId | null>(null);
  const [view, setViewState] = useState<DTestView>('install');

  // Initialise from onboarding state once loading finishes; thereafter
  // auto-flip to dashboard on every false → true transition.
  const didInit = useRef(false);
  const prevOnboarding = useRef(hasCompletedOnboarding);
  useEffect(() => {
    if (isLoading) return;
    if (!didInit.current) {
      setViewState(hasCompletedOnboarding ? 'dashboard' : 'install');
      didInit.current = true;
    } else if (!prevOnboarding.current && hasCompletedOnboarding) {
      setViewState('dashboard');
    }
    prevOnboarding.current = hasCompletedOnboarding;
  }, [hasCompletedOnboarding, isLoading]);

  const setView = useCallback((next: DTestView) => {
    setViewState(next);
    if (next === 'dashboard') setSelectedClient(null);
  }, []);

  // ...provider returned here
}
```

Key points:

- **No URL param, no localStorage.** View is pure session state. Refresh recomputes from `hasCompletedOnboarding`.
- **Single source of truth for view.** `AppHeader.showConnectTip` and `DTestDashboardPage` both read `view` from the same context, so the Connect tip correctly hides while the user is on the Install view.
- **Provider is mounted for every user**, not just d_test. Non-d_test components don't consume it, and `useMcpUsage()` is already React-Query-cached so the extra call is free.
- **`[X]` on Install** calls `setView('dashboard')` — no dismissal flag, no persistence.
- **Top-nav Connect on d_test** (only while on `/dashboard`) calls `setView('install')`.
- **MCP call success** (the `hasCompletedOnboarding` false → true transition) auto-switches to `'dashboard'` so users see their connected state immediately.
- `selectedClient` is session-local; switching to dashboard clears it.

## Feature Flag

All three dashboard variants are gated by a single PostHog flag, `dashboard-v4-experiment`, with values `control` / `c_test` / `d_test`. Every code reference to the older `dashboard-v3-experiment` name is renamed in this change (`AppRoutes.tsx`, `AppLayout.tsx`, `SocketContext.tsx`) so the flag name is consistent everywhere. PostHog flag configuration is a dashboard-side change, out of scope for the code PR.

`AppRoutes.tsx`:

```ts
const dashboardVariant = getFeatureFlag('dashboard-v4-experiment');
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
  - `[X]` on Install page → lands on dashboard view.
  - Connect button in top nav (on `d_test`, on `/dashboard`) → returns to Install page. The Connect-tip under the button hides immediately (it keys on the context `view`, not URL).
  - MCP tool succeeds while on Install → view auto-flips to dashboard and the Connect-tip appears under the button (respecting its own dismissal flag in localStorage).
  - Refresh on either view → re-resolves from `hasCompletedOnboarding`. Connected users land on dashboard; unconnected users land on install. Transient "I clicked Connect to peek" state is intentionally not preserved.
  - Refresh on detail page → returns to Install grid (selectedClient is session-local). Acceptable per design.
- Cross-variant regression:
  - On `default` / `c_test`, Connect button still opens `ConnectDialog` modal, not Install page.
  - `MCPSection` with no `initialAgentId` still defaults to `MCP_AGENTS[0]` as before.
  - `CTestDashboardPage` metric cards still render (now via shared `MetricCard`).

## Risk & Rollback

- Feature-flagged end-to-end; rollback is a PostHog flag change.
- Shared-component edits (`MCPSection`, extracted `MetricCard`) must remain backward-compatible. `initialAgentId` is optional and defaults to today's behavior; extracted `MetricCard` keeps the same props surface.
- `DTestViewProvider` is mounted for all users, not just d_test. It calls `useMcpUsage()` at layout level, but that hook is already invoked by `AppHeader` and is React-Query-cached, so the provider does not add a new request.
- Flag rename (`dashboard-v3-experiment` → `dashboard-v4-experiment`) is applied in every code location. If PostHog still has the v3 flag defined, analytics and variant resolution will simply return `null` for the old name — no runtime error, just the control fallback — so the switch is safe to deploy before/after PostHog-side changes.

## Open Items

- PostHog `d_test` variant configuration (outside code) — needs to be set up before rollout.
