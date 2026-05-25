# PostHog Analytics — Layout Redesign Design

**Status**: Draft
**Date**: 2026-05-24
**Repo**: InsForge (OSS dashboard)
**Scope**: `packages/dashboard/src/features/analytics/*` + sidebar nav + routing
**Figma**:
- Disconnected overview — `3177-62515`
- Traffic — `3174-54062`, `3177-59015`, `3177-59464`
- User Retention — `3177-54743`
- Session Replay — `3181-10216`
- Settings (Analytics Config modal) — `3190-68392`, `3190-68947`

---

## Problem

`AnalyticsPage` is a single stacked page. Disconnected → centered `EmptyConnectPanel`. Connected → top action bar + ConnectStatusBar + Setup-with-Prompt + ApiKeyCard + KPI + 3 Breakdowns + Retention card + Recent Replays card, all in one vertical scroll.

The Figma redesign splits the feature into a **secondary-sidebar pattern** matching how Authentication / Payments / Realtime / Deployments are already organized in the dashboard:

- Left secondary sidebar titled **Analytics** with sub-items **Traffic / User Retention / Session Replay**
- A gear icon in the sidebar header opens an **Analytics Config** modal (connection info + setup prompt + disconnect)
- When PostHog is **not connected**: sub-items are disabled, the gear is disabled, the main area shows a single empty-connect CTA panel
- When connected: each sub-item routes to a focused dashboard page

Goal: implement that layout using existing InsForge components (`FeatureSidebar`, `MenuDialog`, `Button`, etc.) and existing analytics building blocks (`KpiSectionWithTrend`, `BreakdownPanel`, `RetentionCard`, `RecentReplaysCard`). No hardcoded colors / spacing — Tailwind semantic classes + tokens only.

---

## Out of Scope

- New data fetching / new API endpoints — sub-pages reuse existing hooks (`useWebOverview`, `useTrend`, `useRetention`, `useRecordings`, `usePosthogConnection`).
- Changing the Connect / OAuth flow itself — `onConnectPosthog` from `useDashboardHost` stays the contract.
- Self-host parity — `isCloudHosting` gate in `AppRoutes` stays as-is; this feature is cloud-only.
- Feature flagging / phased rollout — staging handled via OSS test tags.

---

## Architecture

### Routes (`router/AppRoutes.tsx`)

Today (single route):
```tsx
{isCloudHosting && <Route path="/dashboard/analytics" element={<AnalyticsPage />} />}
```

After (layout + nested routes, mirrors `/dashboard/authentication` and `/dashboard/payments`):
```tsx
{isCloudHosting && (
  <Route path="/dashboard/analytics" element={<AnalyticsLayout />}>
    <Route index element={<Navigate to="traffic" replace />} />
    <Route path="traffic" element={<TrafficPage />} />
    <Route path="retention" element={<RetentionPage />} />
    <Route path="session-replay" element={<SessionReplayPage />} />
  </Route>
)}
```

The bare `/dashboard/analytics` always redirects to `/traffic` (matches `payments → catalog`, `realtime → channels`). Disconnected state is handled inside `AnalyticsLayout`, not by the router — see below.

### Components

Mirrors `features/auth`, `features/payments`, `features/realtime`, `features/deployments` — Layout / Sidebar / feature-level dialogs all live under `components/`, sub-pages under `pages/`, default-exported Layout imported by `AppRoutes`:

```
features/analytics/
├── components/
│   ├── AnalyticsLayout.tsx          NEW — outer shell (sidebar + Outlet | EmptyConnectPanel). DEFAULT EXPORT.
│   ├── AnalyticsSidebar.tsx         NEW — wraps FeatureSidebar, owns Settings dialog open state. Named export.
│   ├── AnalyticsConfigDialog.tsx    NEW — MenuDialog: connection info + setup prompt + disconnect. Named export.
│   └── posthog/                     (existing — kept)
│       ├── EmptyConnectPanel.tsx    (reused as-is for disconnected main area)
│       ├── ApiKeyCard.tsx           (content folded into AnalyticsConfigDialog; file deleted)
│       ├── ConnectStatusBar.tsx     (content folded into AnalyticsConfigDialog; file deleted)
│       ├── DisconnectDialog.tsx     (kept — triggered from inside AnalyticsConfigDialog)
│       ├── KpiSectionWithTrend.tsx  (used by TrafficPage)
│       ├── BreakdownPanel.tsx       (used by TrafficPage)
│       ├── RetentionCard.tsx        (used by RetentionPage, full-width)
│       ├── RecentReplaysCard.tsx    (used by SessionReplayPage)
│       ├── ReplayModal.tsx          (unchanged — opened from SessionReplayPage)
│       └── TimeRangeSelector.tsx    (rendered in each sub-page's header)
├── pages/                           NEW directory (matches features/auth/pages)
│   ├── TrafficPage.tsx              NEW — named export
│   ├── RetentionPage.tsx            NEW — named export
│   └── SessionReplayPage.tsx        NEW — named export
├── AnalyticsPage.tsx                DELETE (logic split across Layout + pages)
├── index.ts                         UPDATE — drop `export { AnalyticsPage }` (router imports layout directly, matching realtime/payments which have no barrel)
├── context/TimeRangeContext.tsx     (kept — provider moves into AnalyticsLayout)
├── hooks/                           (kept — no changes; useRecordings may grow limit/offset params)
├── lib/                             (kept)
└── services/                        (kept)
```

`AppRoutes.tsx` import follows the existing convention:
```ts
import AnalyticsLayout from '#features/analytics/components/AnalyticsLayout';
import { TrafficPage } from '#features/analytics/pages/TrafficPage';
import { RetentionPage } from '#features/analytics/pages/RetentionPage';
import { SessionReplayPage } from '#features/analytics/pages/SessionReplayPage';
```

### Shared component change

`components/FeatureSidebar.tsx` needs a `disabled` flag on items. Today `FeatureSidebarListItem` only has `id / label / href / sectionEnd / onClick`. Add:

```ts
export interface FeatureSidebarListItem {
  id: string;
  label: string;
  href?: string;
  sectionEnd?: boolean;
  onClick?: () => void;
  disabled?: boolean;   // NEW
}
```

When `disabled === true`:
- The row renders as a `<div>` (not `<Link>`), so clicking is a no-op and there's no router navigation.
- `aria-disabled="true"` on the container.
- Visual: `text-muted-foreground/50 cursor-not-allowed` and no hover treatment (no `hover:bg-alpha-4` / `hover:text-foreground`).
- The hidden `useMatch` result is ignored — disabled items never appear "selected".

`headerButtons` already supports `disabled`, which is what we use for the gear-icon Settings button.

Auth / Payments / Realtime / Deployments sidebars never pass `disabled` today, so adding the optional field is backwards-compatible.

---

## Behavior

### `AnalyticsLayout`

```tsx
export default function AnalyticsLayout() {
  const conn = usePosthogConnection();
  const { projectId, isLoading: projectIdLoading, error: projectIdError } = useProjectId();

  const connected = !conn.isLoading && !conn.isError && !!conn.data;

  return (
    <TimeRangeProvider>
      <div className="flex h-full min-h-0 overflow-hidden bg-[rgb(var(--semantic-1))]">
        <AnalyticsSidebar connected={connected} />
        <div className="min-w-0 flex-1 overflow-hidden">
          {conn.isLoading || projectIdLoading ? (
            <LoadingState />
          ) : conn.isError ? (
            <ErrorState message="Failed to load PostHog connection." />
          ) : !conn.data ? (
            projectIdError || !projectId
              ? <ErrorState message="Failed to load project ID." />
              : <DisconnectedMain projectId={projectId} />
          ) : (
            <Outlet />
          )}
        </div>
      </div>
    </TimeRangeProvider>
  );
}
```

- `LoadingState` / `ErrorState` are existing `#components` exports.
- `DisconnectedMain` is a thin wrapper that centers `EmptyConnectPanel` with appropriate page padding — same CTA, same copy as today (`Connect PostHog`, `One-click setup of a PostHog project for product analytics.`).
- When disconnected, `<Outlet />` is not rendered — so even direct navigation to `/dashboard/analytics/retention` still shows the empty-connect panel. URL stays correct; on connect, React-Query invalidation flips `connected` to `true` and the sub-page mounts.

### `AnalyticsSidebar`

```tsx
const ITEMS = (connected: boolean): FeatureSidebarListItem[] => [
  { id: 'traffic',        label: 'Traffic',        href: '/dashboard/analytics/traffic',        disabled: !connected },
  { id: 'retention',      label: 'User Retention', href: '/dashboard/analytics/retention',      disabled: !connected },
  { id: 'session-replay', label: 'Session Replay', href: '/dashboard/analytics/session-replay', disabled: !connected },
];

export function AnalyticsSidebar({ connected }: { connected: boolean }) {
  const [settingsOpen, setSettingsOpen] = useState(false);
  return (
    <>
      <FeatureSidebar
        title="Analytics"
        items={ITEMS(connected)}
        headerButtons={[{
          id: 'analytics-settings',
          label: 'Analytics Config',
          icon: Settings,
          onClick: () => setSettingsOpen(true),
          disabled: !connected,
        }]}
      />
      <AnalyticsConfigDialog open={settingsOpen} onOpenChange={setSettingsOpen} />
    </>
  );
}
```

Pattern is identical to `AuthenticationSidebar`. No new sidebar styling — disabled visual lives inside `FeatureSidebar`.

### `AnalyticsConfigDialog`

Built on the same `MenuDialog` primitives `AuthSettingsMenuDialog` uses. Figma `3190-68392` shows the modal opened against the disconnected layout (rare — gear is disabled when disconnected, so this is more of a design reference), and `3190-68947` shows it against the connected layout. Both share the same modal structure — one side-nav section, `Connection` content on the right — so a single `AnalyticsConfigDialog` covers both nodes. We keep `MenuDialogSideNav` for visual parity even though there's only one section today:

```tsx
<MenuDialog open={open} onOpenChange={onOpenChange}>
  <MenuDialogContent>
    <MenuDialogSideNav>
      <MenuDialogSideNavHeader>
        <MenuDialogSideNavTitle>Analytics Config</MenuDialogSideNavTitle>
      </MenuDialogSideNavHeader>
      <MenuDialogNav>
        <MenuDialogNavList>
          <MenuDialogNavItem active>Connection</MenuDialogNavItem>
        </MenuDialogNavList>
      </MenuDialogNav>
    </MenuDialogSideNav>
    <MenuDialogMain>
      <MenuDialogHeader>
        <MenuDialogTitle>Connection</MenuDialogTitle>
        <MenuDialogCloseButton />
      </MenuDialogHeader>
      <MenuDialogBody>
        {/* 1. ConnectStatusBar (compact form) */}
        {/* 2. Read-only Input fields: API host, Project ID, API key (with show/hide) */}
        {/* 3. Setup-with-Prompt block (existing inline copy, no new shared component per memory) */}
      </MenuDialogBody>
      <MenuDialogFooter>
        <Button variant="ghost" onClick={() => setDisconnecting(true)}>Disconnect</Button>
      </MenuDialogFooter>
    </MenuDialogMain>
  </MenuDialogContent>
</MenuDialog>
```

`Disconnect` opens the existing `DisconnectDialog` (modal stacking is fine — `AuthSettingsMenuDialog` already nests confirm dialogs the same way).

Fields:
- **API host** — `Input` (read-only), copy button
- **Project ID** — `Input` (read-only), copy button
- **API key** — `Input` (read-only, type=password by default), show/hide toggle, copy button. This is the existing `ApiKeyCard` content lifted into the dialog row layout.

The "Setup with Prompt" block in current `AnalyticsPage.tsx` (lines 121–137) is inlined verbatim into `MenuDialogBody` — per `[[feedback_inline_prompt_block_pattern]]`, do not extract it into a shared component.

### Sub-pages

Each sub-page renders a page header (title + `TimeRangeSelector`) + its content. No outer `<h1>Analytics</h1>` (the sidebar title already says it).

**`TrafficPage`** — Figma `3174-54062 / 3177-59015 / 3177-59464`:
```
[ header:  Traffic                          [ TimeRangeSelector ] ]
[ KpiSectionWithTrend enabled ]
[ grid: BreakdownPanel(Page) | BreakdownPanel(Country) | BreakdownPanel(DeviceType) ]
```
Keep the existing `grid grid-cols-1 md:grid-cols-3 gap-3` from today's `AnalyticsPage` for the 3 breakdown panels — Figma shows the row of 3 side-by-side at standard widths. KPI section spans the full width above.

Node `3174-54062` is the connect-success toast state (`Analytics setup succeeded`) — this surface is rendered by the global toast (`useToast`), already wired in `AnalyticsPage` today. We move that `subscribePosthogConnectionStatus` `useEffect` into `AnalyticsLayout` so the toast still appears when the user is on any sub-route during connect completion.

**`RetentionPage`** — Figma `3177-54743`:
```
[ header:  User Retention                   [ TimeRangeSelector ] ]
[ RetentionCard enabled, full-width ]
```
`RetentionCard` currently sits inside a multi-section scroll — moving it to its own page gives it the full content width per Figma.

**`SessionReplayPage`** — Figma `3181-10216`:
```
[ header:  Session Replay                   [ TimeRangeSelector ] ]
[ RecentReplaysCard enabled, full-width, paginated ]
```
Figma shows pagination at the bottom of the list. `RecentReplaysCard` today returns ~N recent replays; this redesign asks it to paginate. Use `Pagination` from `@insforge/ui`. Pagination logic is a small extension to `useRecordings` (`limit` + `offset`) — covered in the implementation plan.

### `Info` callout about Web Analytics lag

Currently rendered between `ApiKeyCard` and `KpiSectionWithTrend` in `AnalyticsPage`. Keep it visible to users — move it to the **top of TrafficPage** (where the KPI data lives), since that's the surface where the lag would be observed. Same `Info` icon + copy.

---

## Styling (tokens only)

Everything maps to existing Tailwind semantic classes already used by Auth/Payments/Realtime:

| Figma element       | Token / class                                                              |
|---------------------|---------------------------------------------------------------------------|
| Sidebar bg          | `bg-semantic-1` (already on `FeatureSidebar`)                              |
| Sidebar border      | `border-[var(--alpha-8)]` (already on `FeatureSidebar`)                    |
| Active item         | `bg-alpha-8 text-foreground` (already in `FeatureSidebarItemRow`)          |
| Hover               | `hover:bg-alpha-4 hover:text-foreground` (already)                         |
| Disabled item       | `text-muted-foreground/50 cursor-not-allowed` (NEW branch in `FeatureSidebar`) |
| Page bg             | `bg-[rgb(var(--semantic-1))]` (matches `AuthenticationLayout`)             |
| Card bg             | `bg-card`                                                                 |
| Card border         | `border-[var(--alpha-8)]`                                                 |
| Foreground text     | `text-foreground` / `text-muted-foreground`                                |
| Modal overlay/chrome | inherited from `MenuDialog` primitives — nothing to set per-instance      |

No hex values, no `bg-[#1B1B1B]`, no inline rgba.

---

## Risks / Edge Cases

1. **Direct deep-link to a sub-route while disconnected.** Handled — `AnalyticsLayout` swaps in `EmptyConnectPanel` regardless of which child route matches. URL keeps the user's intended destination so post-connect they see the right page after a single React-Query refetch.

2. **Connection state flipping mid-session** (cloud completes OAuth in another tab). `usePosthogConnection` already wires React-Query invalidation via `subscribePosthogConnectionStatus`. We move that subscription from `AnalyticsPage` into `AnalyticsLayout` so it's active on every sub-route.

3. **`projectId` resolves after `conn.data`.** Current code holds the connected view until `projectId` is available. Layout preserves that — it renders `LoadingState` until both resolve.

4. **`onConnectPosthog` undefined** (host doesn't provide it). `EmptyConnectPanel` already disables the button in that case; no change needed.

5. **Pagination behavior on Session Replay.** New `limit/offset` params on `useRecordings`. If the current backend endpoint only returns a fixed page, the implementation plan should confirm pagination parameters are supported before wiring `Pagination`. Fallback: keep showing the top-N list without pagination, hide the control.

6. **`MenuDialog` z-index vs `DisconnectDialog`.** Auth already stacks `Dialog`-on-`MenuDialog` (Mail provider config + confirms). The same Radix portal stacking applies — no new work.

---

## File-Level Change Summary

| File | Change |
|------|--------|
| `packages/dashboard/src/components/FeatureSidebar.tsx` | Add `disabled?: boolean` to `FeatureSidebarListItem`; render disabled variant in `FeatureSidebarItemRow` (no `<Link>`, `aria-disabled`, muted tokens, no hover). |
| `packages/dashboard/src/features/analytics/components/AnalyticsLayout.tsx` | NEW (default export) — sidebar + Outlet, owns `usePosthogConnection` + `TimeRangeProvider` + connect-status `useEffect`, falls back to `EmptyConnectPanel` when disconnected. |
| `packages/dashboard/src/features/analytics/components/AnalyticsSidebar.tsx` | NEW (named export) — wraps `FeatureSidebar` with title `Analytics`, 3 sub-items, Settings header button. |
| `packages/dashboard/src/features/analytics/components/AnalyticsConfigDialog.tsx` | NEW (named export) — `MenuDialog` with `Connection` section: read-only host / project ID / API key inputs, Setup-with-Prompt block, Disconnect button. |
| `packages/dashboard/src/features/analytics/pages/TrafficPage.tsx` | NEW — header (`Traffic` + TimeRangeSelector) + lag `Info` + `KpiSectionWithTrend` + 3 `BreakdownPanel`s. |
| `packages/dashboard/src/features/analytics/pages/RetentionPage.tsx` | NEW — header + `RetentionCard`. |
| `packages/dashboard/src/features/analytics/pages/SessionReplayPage.tsx` | NEW — header + `RecentReplaysCard` + `Pagination`. |
| `packages/dashboard/src/features/analytics/AnalyticsPage.tsx` | DELETE — superseded. |
| `packages/dashboard/src/features/analytics/components/posthog/ApiKeyCard.tsx` | DELETE — content lifted into `AnalyticsConfigDialog`. |
| `packages/dashboard/src/features/analytics/components/posthog/ConnectStatusBar.tsx` | DELETE — content lifted into `AnalyticsConfigDialog`. |
| `packages/dashboard/src/features/analytics/index.ts` | Replace `export { AnalyticsPage }` with no-op (delete file) or empty — router imports Layout directly. Match `realtime` / `payments` which have no barrel. |
| `packages/dashboard/src/router/AppRoutes.tsx` | Replace single `<Route path="/dashboard/analytics" element={<AnalyticsPage />} />` with `<Route path="/dashboard/analytics" element={<AnalyticsLayout />}>` + nested `index → Navigate to traffic`, `/traffic`, `/retention`, `/session-replay`. Drop the `import { AnalyticsPage } from '#features/analytics'` line, add new imports per the new convention. |
| `packages/dashboard/src/features/analytics/hooks/useRecordings.ts` | Extend with `limit` / `offset` params for pagination (verify backend support in implementation plan; fallback to top-N list if not). |

---

## Acceptance Criteria

1. `/dashboard/analytics` (cloud) — disconnected:
   - Left sidebar titled **Analytics** with 3 disabled sub-items and a disabled gear icon
   - Main area shows the `Connect PostHog` empty state (centered, single CTA)
   - Clicking a disabled sub-item does nothing; URL does not change
2. `/dashboard/analytics` — connected:
   - Auto-redirects to `/dashboard/analytics/traffic`
   - All 3 sub-items enabled, gear icon enabled
3. `/dashboard/analytics/traffic` — connected:
   - Page header with title + time range selector
   - Web Analytics lag `Info` callout above the KPI row
   - KPI row + 3 breakdown sections
4. `/dashboard/analytics/retention` — `RetentionCard` full-width
5. `/dashboard/analytics/session-replay` — `RecentReplaysCard` full-width + bottom `Pagination`
6. Gear icon opens **Analytics Config** modal:
   - Read-only host / project ID / API key inputs (key hidden by default with show toggle)
   - Setup-with-Prompt copyable block
   - Disconnect button → existing `DisconnectDialog` confirm flow
7. Disconnecting from inside the modal returns the user to the disconnected layout (sub-items disabled, empty CTA).
8. No hex values / inline rgba added anywhere — every color/border/spacing is a Tailwind semantic class or existing CSS var.
9. `isCloudHosting` route gate behavior unchanged — self-hosted dashboards still don't show Analytics.
