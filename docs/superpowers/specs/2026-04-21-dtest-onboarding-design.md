# D Test Onboarding Design

**Status:** Implemented
**Owner:** @CarmenDou
**Date:** 2026-04-21 (originally) · Updated 2026-04-25
**Branch:** `feat/support-dtest-onboarding` · **PR:** [#1142](https://github.com/InsForge/insforge-cloud-backend/pull/1142)

## Context

Dashboard home is gated by a single PostHog feature flag `dashboard-v4-experiment` with two variants:

- default / `control` (`DashboardPage`) — baseline, unchanged
- `d_test` — new **install-first** onboarding introduced in this spec

(An earlier `c_test` variant was retired during d_test development; the `CTestDashboardPage` and `ConnectDialogV2` files were deleted, with the prompt stepper carried forward into the d_test connected dashboard.)

D test ships a reworked "Install InsForge" client picker as the pre-connection view, and a connected dashboard (header + 4 metric cards + prompt stepper). On d_test the top-nav Connect button does **not** open any dialog — it switches the page back to the Install view so users can re-visit setup at any time. When dashboard runs inside the InsForge cloud control plane (`insforge.dev`) iframe, the parent's Connect button mirrors this behaviour through a `D_TEST_VIEW_CHANGED` postMessage.

Figma references:
- Install InsForge (client picker): `2194:75236`
- Client detail page (Claude Code example): `2226:78350`
- Connection String detail: `2226:79152`
- Connected dashboard: `2380:89947`

## Goals

1. Let users connect any coding agent (OpenClaw, Claude Code, Codex, Antigravity, Cursor, OpenCode, Copilot, Cline, "Other") or connect directly via DB connection string / API keys, from a single discoverable page.
2. On the connected dashboard show: project header + 4 metric cards (User / Database / Storage / Edge Functions) + a "Your Agent can now do the work for you" prompt stepper to guide further exploration.
3. Use d_test–owned install components (`DTestCLISection`, `DTestMCPSection`, `QuickStartPromptCard`) that can iterate independently of the legacy connect UI; keep the shared `ConnectionStringSectionV2` / `APIKeysSectionV2` for direct-connect tiles.
4. Allow users to toggle between Install view and Dashboard view freely after first connection, including from the InsForge cloud control plane's top-bar Connect button (cross-frame postMessage).

## Non-Goals

- Changing the install commands themselves at the CLI / MCP level (the CLI prompt is a copy-paste recipe; MCP JSON / install commands are the existing ones). The d_test prompt does inject a fresh user API key into the CLI command and substitutes the real DB password into the connection-string prompt — both are display-only changes.
- Changing onboarding detection logic beyond what `useMcpUsage().hasCompletedOnboarding` already provides.
- Replacing the `ConnectDialog` for the `control` variant — it keeps the existing modal.

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

Thereafter, the view only changes on three events:

1. **Onboarding completes** (`hasCompletedOnboarding` flips false → true): auto-switch to `'dashboard'`. This is the "MCP call succeeds → jump to dashboard" UX.
2. **Connect clicked** (in d_test) — either our top-nav Connect button (`AppHeader`) when the dashboard renders standalone, or the **InsForge cloud control plane's** top-bar Connect button via `SHOW_CONNECT_OVERLAY` / `SHOW_ONBOARDING_OVERLAY` postMessage (the iframe scenario). Both route to `setView('install')`. While view is `'install'`, the Connect button is rendered as **disabled** so the user doesn't loop on it.
3. **`[X]` clicked on Install page**: switch to `'dashboard'`.

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

- CLI / MCP toggle (`toggle nav` pattern from Figma) — only rendered when the entry's `tabs` field exposes more than one tab. **OpenClaw** has `tabs: ['cli']` (CLI only, no toggle); **Other Agents** has `tabs: ['mcp']` (MCP only, jumps directly into the MCP JSON config); the rest default to both.
- **CLI tab** → `<DTestCLISection agentName={...} />`. The prompt embeds a real `uak_…` user API key minted by the cloud control plane (`onRequestUserApiKey` callback) on every section mount, with a 3-month TTL — falls back to `<placeholder>` when the host doesn't provide the callback (self-hosted preview).
- **MCP tab** → `<DTestMCPSection agentId={id} apiKey={...} appUrl={...} />`.
  - For specific agents, `agentId` matches the tile id (`openclaw`, `claude-code`, `codex`, `cursor`, `antigravity`, `opencode`, `copilot`, `cline`).
  - For "Other Agents", the entry sets `mcpAgentId: 'mcp'` which jumps directly to the MCP JSON config (no agent dropdown needed).
  - For Cursor and Qoder (deeplink-capable), Step 1 shows an "Install to &lt;agent&gt;" button that opens the MCP-install deeplink and Step 2 shows a "Paste Prompt to &lt;agent&gt;" button that opens the agent's chat-with-prompt deeplink (`cursor://anysphere.cursor-deeplink/prompt?text=...` or `qoder://aicoding.aicoding-deeplink/chat?text=...&mode=agent`). Falls back to clipboard copy if the prompt exceeds Cursor's 8000-char URL limit. Other agents show the terminal command + prompt code blocks.

### Connection String tile

- No CLI/MCP toggle.
- Wrapped in a `<QuickStartPromptCard />` whose prompt embeds the real DB connection string (parent's API returns it with the password masked as `********`; we substitute the real password in via `useDatabasePassword()` so the prompt is paste-ready).
- Below the prompt: `<ConnectionStringSectionV2 variant="vertical" />` with a Show/Hide toggle on the password field. The "copy parameters" button always copies the real password regardless of reveal state, matching the connection-string copy behavior.
- Title: "Connection String", icon: database.

### API Keys tile

- No CLI/MCP toggle.
- Content: `<APIKeysSectionV2 apiKey={...} anonKey={...} appUrl={...} />`.
- Title: "API Keys", icon: key.

## Connected Dashboard Layout

Matches Figma node `2380:89947`, with the prompt stepper carried over from the (now-deleted) c_test design.

```text
<h1> My Project </h1>  [INSTANCE BADGE]  ● Healthy

┌──────┐ ┌──────┐ ┌──────┐ ┌──────┐
│ User │ │ DB   │ │ Stor │ │ Fns  │
└──────┘ └──────┘ └──────┘ └──────┘

┌─────────────────────────────────────────────────────────┐
│  Your Agent can now do the work for you      [Dismiss] │
│  Open your coding agent and start building your        │
│  project with prompts                                  │
│                                                         │
│  ┌────────────────┬──────────────────────────────────┐ │
│  │ Database       │  Step content (icon, title,      │ │
│  │ Authentication │  prompt body, Copy / Go-to)      │ │
│  │ Storage        │                                  │ │
│  │ Model Gateway  │                                  │ │
│  │ Deployment     │                                  │ │
│  └────────────────┴──────────────────────────────────┘ │
└─────────────────────────────────────────────────────────┘
```

Project title, instance-type badge, and health badge use `useCloudProjectInfo` + `useMetadata`. Each metric card uses the shared `MetricCard` component. The stepper is the self-contained `DashboardPromptStepper` — see the next section.

## Prompt Stepper (`DashboardPromptStepper`)

A 5-step "Start building" stepper rendered below the metric cards. Self-contained: each instance manages its own dismiss flag and step-completion derivation.

- **5 steps** (database → auth → storage → model gateway → deployment), each with a copy-pastable prompt and a "Go to &lt;area&gt;" button.
- **Live completion detection** from existing hooks (intentionally schema-agnostic so prompts work for any project, not just a fixed demo):
  - `database` → `tables.some(t => t.recordCount > 0)` (any user table has rows)
  - `auth` → `totalUsers >= 1`
  - `storage` → `storage.buckets.length > 0` (any bucket exists)
  - `ai` → `aiUsageSummary.totalRequests > 0`
  - `deployment` → `currentDeploymentId` exists
- **Sticky completion**: once a step is detected complete, it stays complete in localStorage (`insforge-ctest-step-<key>-done-<projectId>`) even if the agent later removes the source data (e.g. via newly added RLS policies). Key prefix is `insforge-ctest-` for backwards compatibility with users who progressed through c_test.
- **Dismiss**: persists `insforge-prompt-stepper-dismissed-<projectId>` in localStorage. Once dismissed for a project, the stepper never shows for that project again.

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
        ├── DTestConnectedDashboard.tsx      # header + 4 metric cards + prompt stepper
        ├── DTestCLISection.tsx              # CLI tab content (prompt with real uak_ key)
        ├── DTestMCPSection.tsx              # MCP tab content (deeplinks for Cursor/Qoder, terminal/JSON for others)
        ├── DTestConnectTip.tsx              # fixed-position "you can re-connect" tip overlay (cloud-hosting only)
        ├── DTestViewContext.tsx             # React context: view + selectedClient + cross-frame postMessage
        ├── DashboardPromptStepper.tsx       # self-contained 5-step stepper for connected dashboard
        ├── QuickStartPromptCard.tsx         # generic "Paste this into your agent" prompt card
        └── clientRegistry.tsx               # tile metadata (id, label, icon, kind, mcpAgentId, tabs)
```

Plus a logo asset for the Other Agents tile (`assets/logos/other_agents.svg`) and updated logos for Claude Code (PNG) and Codex (SVG).

### Shared components extracted

```text
packages/dashboard/src/features/dashboard/components/
└── MetricCard.tsx     # lifted from CTestDashboardPage.tsx (currently an inner function)
```

`CTestDashboardPage.tsx` loses its inner `MetricCard` definition and imports the shared one.

### Modified files

- `packages/dashboard/src/router/AppRoutes.tsx`
  - Pick `DTestDashboardPage` when `dashboardVariant === 'd_test'`, otherwise `DashboardPage`.
- `packages/dashboard/src/layout/AppLayout.tsx`
  - Always render the `ConnectDialog` (v1); the `c_test`-branched V2 dialog was removed.
  - Wrap the layout tree in `DTestViewProvider` so `AppHeader`, `DTestDashboardPage`, `DTestConnectTip`, and `AppSidebar` all share view state.
  - Add `ConnectOverlayBridge` (rendered inside the provider) — listens for `SHOW_CONNECT_OVERLAY` / `SHOW_ONBOARDING_OVERLAY` postMessages from the parent window. In d_test, routes the signal to `setView('install')` instead of opening the dialog.
- `packages/dashboard/src/layout/AppHeader.tsx`
  - On d_test: Connect onClick calls `setView('install')` from `DTestViewContext`. Disabled when already on the Install view.
  - Tip JSX/state was extracted to `DTestConnectTip` (fixed-position overlay, see below).
- `packages/dashboard/src/layout/AppSidebar.tsx`
  - Don't highlight the Dashboard nav item while the user is on the d_test Install view.
- `packages/dashboard/src/lib/config/DashboardHostContext.tsx`
  - Add `onRequestUserApiKey?: () => Promise<string>` to the host contract, plumbed through `InsforgeDashboard` props.
- `packages/dashboard/src/lib/analytics/posthog.tsx`
  - Restore `session_recording: { recordCrossOriginIframes: true }` so PostHog session replay doesn't choke on the cross-origin iframe boundary (was dropped in an earlier refactor).
- `packages/dashboard/src/lib/contexts/SocketContext.tsx`
  - Rename the `experiment_variant` tag on `onboarding_completed` analytics to `dashboard-v4-experiment`.

#### Frontend bridge (`frontend/src/cloud-hosting/`)

- `useCloudHosting.ts`: adds `requestUserApiKey()` (REQUEST_USER_API_KEY postMessage with USER_API_KEY / USER_API_KEY_ERROR response).
- `CloudHostingDashboard.tsx`: passes `onRequestUserApiKey={requestUserApiKey}` through to `InsForgeDashboard`.

### Deleted files

- `packages/dashboard/src/features/dashboard/pages/CTestDashboardPage.tsx` — c_test variant retired; the prompt stepper was extracted into `DashboardPromptStepper.tsx`.
- `packages/dashboard/src/features/dashboard/components/connect/ConnectDialogV2.tsx` — only used by c_test.

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
  detailIcon: ReactNode;
  kind: 'agent' | 'direct-connect';
  /** MCP detail preselection. Use 'mcp' for "Other Agents"; omit for direct-connect. */
  mcpAgentId?: string;
  /**
   * Tabs available on the detail page for `kind: 'agent'`. Omit = both CLI and
   * MCP. Use ['cli'] for OpenClaw (install flow only), ['mcp'] for "Other
   * Agents" (drops straight into the MCP JSON config).
   */
  tabs?: ReadonlyArray<'cli' | 'mcp'>;
};
```

`FEATURED_OPENCLAW_ID = 'openclaw'` is the featured tile in Section 1; `CODING_AGENT_GRID_IDS` renders the Section 2 grid starting with `'claude-code'`. The `other` entry sets `mcpAgentId: 'mcp'` and `tabs: ['mcp']`; OpenClaw sets `tabs: ['cli']`.

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

## Cross-frame postMessage protocol

When the dashboard runs inside the InsForge cloud control plane (`insforge.dev`) via iframe, it coordinates with the parent through several postMessage events:

| Direction | Type | Purpose |
|---|---|---|
| Parent → iframe | `SHOW_CONNECT_OVERLAY` / `SHOW_ONBOARDING_OVERLAY` | Parent's top-bar Connect button click. iframe handles in `ConnectOverlayBridge`: in d_test → `setView('install')`; otherwise → opens the v1 ConnectDialog. |
| iframe → Parent | `D_TEST_VIEW_CHANGED { view: 'install' \| 'dashboard' }` | View state mirror. Parent's `ConnectButton` reads this and disables itself while view is `'install'`. Only sent when the variant is `d_test`. |
| iframe → Parent | `REQUEST_USER_API_KEY` | Iframe wants a fresh `uak_…` PAT for the CLI install prompt. |
| Parent → iframe | `USER_API_KEY { apiKey }` / `USER_API_KEY_ERROR { error }` | Response to the above. Parent's `userApiKeyService` calls `POST /account/v1/api-keys` with a 90-day TTL. |

The `useCloudHosting` hook (in `frontend/src/cloud-hosting/`) owns the iframe-side request/response bookkeeping; the parent side lives in `insforge-cloud/src/app/dashboard/project/[projectId]/page.tsx` (existing handler) and `insforge-cloud/src/features/project/components/ConnectButton.tsx` (new disable-state subscriber).

## Feature Flag

Dashboard variant is gated by a single PostHog flag, `dashboard-v4-experiment`. Resolved values:

- `'d_test'` → `DTestDashboardPage`
- anything else → `DashboardPage` (the legacy default)

```ts
// AppRoutes.tsx
const dashboardVariant = getFeatureFlag('dashboard-v4-experiment');
const DashboardHomePage = dashboardVariant === 'd_test' ? DTestDashboardPage : DashboardPage;
```

PostHog flag configuration is dashboard-side, out of scope for the code PR. The `dashboard-v3-experiment` flag is no longer referenced in code; SocketContext analytics report `dashboard-v4-experiment` instead.

## Testing

This is a UI-only change; verification is primarily manual through the dev server (PostHog override) and the staging cloud control plane (real iframe).

- For each variant (`control`, `d_test`):
  - Load `/dashboard` with an account that has **no** MCP usage → correct "unconnected" view renders.
  - Load `/dashboard` with an account that has MCP usage → correct "connected" view renders.
- D-test-specific flows (self-hosted preview):
  - Click each agent tile → detail page renders with the right icon/title. OpenClaw shows CLI only. Other Agents shows MCP only. Other agents show CLI/MCP toggle, default to CLI.
  - Click Connection String tile → prompt + `ConnectionStringSectionV2` rendered inside detail shell. Real DB password substituted in the prompt and copy.
  - Click API Keys tile → `APIKeysSectionV2` renders inside the detail shell.
  - `← All Clients` from any detail → back to grid.
  - `[X]` on Install page → lands on dashboard view.
  - Connect button in top nav (on d_test) → routes to Install page. Becomes disabled while on Install.
  - MCP tool succeeds while on Install → view auto-flips to dashboard.
  - Cursor / Qoder "Paste Prompt to" button opens deeplink (URL bar shows `cursor://` or `qoder://`); for other agents, copies to clipboard.
- D-test-specific flows (cloud iframe — staging):
  - Connect button in InsForge cloud's top-bar disables while iframe view = `'install'`.
  - CLI install prompt embeds a real `uak_…` key (each tab mount mints a new one).
  - DTestConnectTip overlay appears in cloud-hosting on dashboard view; dismiss persists per project.
  - Sidebar Dashboard nav item not highlighted while on Install view.
- Cross-variant regression:
  - On `control`, Connect button still opens `ConnectDialog` modal, not Install page.

## Risk & Rollback

- Feature-flagged end-to-end; rollback is a PostHog flag change (set to `control` or remove).
- `DTestViewProvider` is mounted for all users, not just d_test. It calls `useMcpUsage()` at layout level, but that hook is already invoked by `AppHeader` and is React-Query-cached, so the provider does not add a new request.
- Cross-frame postMessage requires both halves (iframe-side `D_TEST_VIEW_CHANGED` emit + parent-side `ConnectButton` listener) to be deployed. Either half landing alone is harmless: the parent's Connect button just defaults to enabled, and the iframe's bridge silently no-ops if no listener exists.
- User API key minting flow gates on `host.onRequestUserApiKey` being defined. Self-hosted installs (no host callback) fall back to `<placeholder>` in the CLI prompt — visible but obviously placeholder, copy disabled.
- Backend-side: the cloud control plane's `userApiKeyService` calls `POST /account/v1/api-keys` with a 90-day TTL. Backend has a soft `MAX_ACTIVE_KEYS_PER_USER = 500` cap (in `appConfig.limits.maxActiveApiKeysPerUser`); on overflow returns 409 which surfaces as "Could not generate API key" in the UI without crashing.

## Connect Tip (`DTestConnectTip`)

Floating "You can always click here to re-connect" hint that appears on the connected dashboard view in cloud-hosting only. Rendered at `AppLayout` level (NOT inside `AppHeader`, because `showNavbar={false}` hides our `AppHeader` when the dashboard runs inside the cloud iframe — the tip needs to live outside it).

Display conditions (all must be true):
- `host.mode === 'cloud-hosting'`
- `dashboardVariant === 'd_test'`
- Current view = `'dashboard'`
- Not dismissed (per-project localStorage flag `insforge-dtest-connect-tip-dismissed-<projectId>`)

Position: `fixed right-4`. Top offset depends on `host.showNavbar`: `top-2` when our AppHeader is hidden (cloud-hosting iframe — sits just below the parent's top bar) or `top-14` when it shows (self-hosted preview — clears our 48px AppHeader). Dismissed state persists per-project; once dismissed, the tip never reappears for that project.

The arrow on the tip card points up at the (parent's) Connect button via offset `right-[72px]` within the 220px-wide card.

## Open Items

- None at the time of merge — d_test variant configuration in PostHog is set up; backend's `MAX_ACTIVE_KEYS_PER_USER = 500` cap is in place.
