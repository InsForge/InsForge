# PostHog Analytics — Layout Redesign Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Restructure `/dashboard/analytics` from a single-page stack into a sidebar + nested sub-routes (Traffic / User Retention / Session Replay), with sidebar items disabled when PostHog is not connected, and a Settings modal that holds connection info / setup prompt / disconnect.

**Architecture:** Mirror the existing OSS pattern used by `features/auth`, `features/payments`, `features/realtime`, `features/deployments`: `AnalyticsLayout` (default export, sidebar + `<Outlet />` | `EmptyConnectPanel`) + `AnalyticsSidebar` (wraps `FeatureSidebar`) + `AnalyticsConfigDialog` (`MenuDialog` for settings) + sub-pages under `pages/`. Shared change: add optional `disabled` flag to `FeatureSidebarListItem`. All styling via Tailwind semantic classes and existing CSS variables — no hex / rgba.

**Tech Stack:** React 18 + react-router-dom v6 + @tanstack/react-query + Tailwind + `@insforge/ui` (Button, MenuDialog family, Pagination, Input, CopyButton) + existing dashboard `#components` (`FeatureSidebar`, `LoadingState`, `ErrorState`, `PaginationControls`). Tests with vitest + @testing-library/react.

**Spec:** `docs/superpowers/specs/2026-05-24-posthog-analytics-layout-redesign-design.md`

---

## File Map (locks decomposition before tasks start)

| File | Action | Responsibility |
|------|--------|----------------|
| `packages/dashboard/src/components/FeatureSidebar.tsx` | MODIFY | Add `disabled` to `FeatureSidebarListItem`; render row as non-link with `aria-disabled` + muted tokens when set. |
| `packages/dashboard/src/components/__tests__/FeatureSidebar.test.tsx` | CREATE | Component test verifying disabled rendering + no navigation. |
| `packages/dashboard/src/features/analytics/components/AnalyticsLayout.tsx` | CREATE | Default-export layout: sidebar + (connection-aware) `<Outlet />` or `EmptyConnectPanel`. Owns `TimeRangeProvider` and the `subscribePosthogConnectionStatus` toast effect. |
| `packages/dashboard/src/features/analytics/components/AnalyticsSidebar.tsx` | CREATE | Wraps `FeatureSidebar` with title `Analytics`, 3 sub-items (disabled when `!connected`), Settings header button (disabled when `!connected`) that opens `AnalyticsConfigDialog`. |
| `packages/dashboard/src/features/analytics/components/AnalyticsConfigDialog.tsx` | CREATE | `MenuDialog` with one `Connection` section: host / project ID / API key (read-only inputs with show-toggle + copy), Setup-with-Prompt block, footer Disconnect → triggers existing `DisconnectDialog`. |
| `packages/dashboard/src/features/analytics/pages/TrafficPage.tsx` | CREATE | Page header (`Traffic` + `TimeRangeSelector`) + lag `Info` callout + `KpiSectionWithTrend` + `grid-cols-1 md:grid-cols-3` of `BreakdownPanel` (Page / Country / DeviceType). |
| `packages/dashboard/src/features/analytics/pages/RetentionPage.tsx` | CREATE | Page header + `RetentionCard` full-width. |
| `packages/dashboard/src/features/analytics/pages/SessionReplayPage.tsx` | CREATE | Page header + `RecentReplaysCard` rendered with paginated slice + `PaginationControls`. |
| `packages/dashboard/src/features/analytics/components/posthog/RecentReplaysCard.tsx` | MODIFY | Accept `items` + `isLoading` + `error` from parent (lift fetching out so the page owns pagination state). Drop the internal `useRecordings(10, enabled)` call. |
| `packages/dashboard/src/features/analytics/AnalyticsPage.tsx` | DELETE | Superseded by Layout + sub-pages. |
| `packages/dashboard/src/features/analytics/components/posthog/ApiKeyCard.tsx` | DELETE | Content moved into `AnalyticsConfigDialog`. |
| `packages/dashboard/src/features/analytics/components/posthog/ConnectStatusBar.tsx` | DELETE | Content moved into `AnalyticsConfigDialog`. |
| `packages/dashboard/src/features/analytics/index.ts` | MODIFY | Replace `export { AnalyticsPage }` with empty file (router imports Layout directly). |
| `packages/dashboard/src/router/AppRoutes.tsx` | MODIFY | Replace single-route with nested layout + 3 sub-routes + index redirect. Swap import. |

**No backend changes.** `getRecordings(limit)` stays as-is — `SessionReplayPage` fetches a window (limit=50) and paginates client-side.

**Commit cadence:** Each task ends with a commit. Commit messages are subject-only single-line (per repo convention, no body, no Co-Authored-By trailer).

---

## Task 1 — Add `disabled` to `FeatureSidebarListItem`

**Files:**
- Modify: `packages/dashboard/src/components/FeatureSidebar.tsx`
- Create: `packages/dashboard/src/components/__tests__/FeatureSidebar.test.tsx`

- [ ] **Step 1: Write the failing test**

Create `packages/dashboard/src/components/__tests__/FeatureSidebar.test.tsx`:

```tsx
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { FeatureSidebar, type FeatureSidebarListItem } from '../FeatureSidebar';

describe('FeatureSidebar disabled items', () => {
  const items: FeatureSidebarListItem[] = [
    { id: 'a', label: 'Active Item', href: '/a' },
    { id: 'b', label: 'Disabled Item', href: '/b', disabled: true },
  ];

  it('renders disabled item without a link and with aria-disabled', () => {
    render(
      <MemoryRouter>
        <FeatureSidebar title="Test" items={items} />
      </MemoryRouter>
    );

    const enabled = screen.getByRole('link', { name: 'Active Item' });
    expect(enabled).toHaveAttribute('href', '/a');

    expect(screen.queryByRole('link', { name: 'Disabled Item' })).toBeNull();

    const disabledRow = screen.getByText('Disabled Item').closest('[aria-disabled="true"]');
    expect(disabledRow).not.toBeNull();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd packages/dashboard && npx vitest run src/components/__tests__/FeatureSidebar.test.tsx`
Expected: FAIL — `Disabled Item` is currently rendered as a `<Link>`, so `getByRole('link', { name: 'Disabled Item' })` would succeed, and no element has `aria-disabled="true"`. The assertions on `queryByRole(...).toBeNull()` and `.closest('[aria-disabled="true"]')` will fail.

- [ ] **Step 3: Add the `disabled` field to the type**

Edit `packages/dashboard/src/components/FeatureSidebar.tsx` — locate the `FeatureSidebarListItem` interface (around line 56) and add the `disabled` field:

```ts
export interface FeatureSidebarListItem {
  id: string;
  label: string;
  href?: string;
  sectionEnd?: boolean;
  onClick?: () => void;
  disabled?: boolean;
}
```

- [ ] **Step 4: Render the disabled variant in `FeatureSidebarItemRow`**

Still in `packages/dashboard/src/components/FeatureSidebar.tsx` — replace the body of `FeatureSidebarItemRow` (the function around line 72) so the wrapping `<div>` checks `disabled` and renders a non-link, no-hover, muted-token row. Replace the existing `return (...)` block with:

```tsx
return (
  <>
    <div
      aria-disabled={item.disabled || undefined}
      className={cn(
        'flex w-full items-center gap-1 rounded px-1.5 transition-colors',
        item.disabled
          ? 'text-muted-foreground/50 cursor-not-allowed'
          : isSelected
            ? 'bg-alpha-8 text-foreground'
            : 'text-muted-foreground hover:bg-alpha-4 hover:text-foreground'
      )}
    >
      {item.disabled ? (
        <div className="flex min-w-0 flex-1 items-center px-2 py-1.5">
          <p className="truncate text-sm leading-5">{item.label}</p>
        </div>
      ) : item.href ? (
        <Link
          to={item.href}
          onClick={handleItemClick}
          className="flex min-w-0 flex-1 items-center px-2 py-1.5"
        >
          <p className={cn('truncate text-sm leading-5', isSelected && 'text-inherit')}>
            {item.label}
          </p>
        </Link>
      ) : (
        <div
          className="h-auto min-w-0 flex-1 justify-start pl-2 pr-1 py-1.5 text-left text-sm leading-5 text-inherit cursor-pointer"
          onClick={handleItemClick}
        >
          <p className="truncate">{item.label}</p>
        </div>
      )}

      {!item.disabled && menuActions.length > 0 ? (
        <DropdownMenu>
          <DropdownMenuTrigger asChild onClick={(e) => e.stopPropagation()}>
            <Button
              variant="ghost"
              size="icon-sm"
              className={cn(
                'h-6 w-6 rounded p-0',
                isSelected
                  ? 'text-foreground hover:bg-alpha-8'
                  : 'text-muted-foreground hover:bg-alpha-8'
              )}
            >
              <MoreVertical className="h-4 w-4" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-44">
            {menuActions.map((action) => (
              <DropdownMenuItem
                key={action.id}
                className={cn('cursor-pointer', action.destructive && 'text-destructive')}
                onClick={(e) => {
                  e.stopPropagation();
                  action.onClick(item);
                }}
              >
                {action.icon && <action.icon className="mr-2 h-4 w-4" />}
                {action.label}
              </DropdownMenuItem>
            ))}
          </DropdownMenuContent>
        </DropdownMenu>
      ) : (
        !item.disabled &&
        showItemMenuButton && (
          <Button
            variant="ghost"
            size="icon-sm"
            className={cn(
              'h-6 w-6 rounded p-0',
              isSelected
                ? 'text-foreground hover:bg-alpha-8'
                : 'text-muted-foreground hover:bg-alpha-8'
            )}
            onClick={(e) => {
              e.preventDefault();
              e.stopPropagation();
              onItemMenuClick?.(item);
            }}
          >
            <MoreVertical className="h-4 w-4" />
          </Button>
        )
      )}
    </div>

    {item.sectionEnd && <div className="my-1.5 h-px w-full bg-alpha-8" />}
  </>
);
```

(Hover / active classes use existing tokens; disabled uses `text-muted-foreground/50` — Tailwind opacity modifier on the existing semantic token. No hex.)

- [ ] **Step 5: Run test to verify it passes**

Run: `cd packages/dashboard && npx vitest run src/components/__tests__/FeatureSidebar.test.tsx`
Expected: PASS.

- [ ] **Step 6: Also run the lint / typecheck to make sure other sidebars still compile**

Run: `cd packages/dashboard && npx tsc --noEmit`
Expected: PASS (no new errors; existing sidebars don't pass `disabled` so they stay untouched).

- [ ] **Step 7: Commit**

```bash
git add packages/dashboard/src/components/FeatureSidebar.tsx packages/dashboard/src/components/__tests__/FeatureSidebar.test.tsx
git commit -m "feat(dashboard): support disabled items in FeatureSidebar"
```

---

## Task 2 — Lift `useRecordings` fetching out of `RecentReplaysCard`

Required before `SessionReplayPage` can paginate (the page owns the list, the card just renders).

**Files:**
- Modify: `packages/dashboard/src/features/analytics/components/posthog/RecentReplaysCard.tsx`

- [ ] **Step 1: Change the component props**

Replace `packages/dashboard/src/features/analytics/components/posthog/RecentReplaysCard.tsx` entirely with:

```tsx
import { useState } from 'react';
import type { PosthogRecording } from '@insforge/shared-schemas';
import { formatDuration, formatRelativeTime, truncateId } from '#features/analytics/lib/format';
import { ReplayModal } from './ReplayModal';

interface RecentReplaysCardProps {
  items: PosthogRecording[];
  isLoading: boolean;
  error: unknown;
}

export function RecentReplaysCard({ items, isLoading, error }: RecentReplaysCardProps) {
  const [openId, setOpenId] = useState<string | null>(null);

  if (isLoading) {
    return (
      <div className="rounded-lg bg-card p-4">
        <h3 className="mb-3 text-sm font-semibold text-foreground">Recent replays</h3>
        <div className="text-sm text-muted-foreground">Loading…</div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="rounded-lg bg-destructive/10 p-4">
        <h3 className="mb-3 text-sm font-semibold text-destructive">Recent replays</h3>
        <div className="text-sm text-destructive">Failed to load replays.</div>
      </div>
    );
  }

  if (items.length === 0) {
    return (
      <div className="rounded-lg bg-card p-4">
        <h3 className="mb-3 text-sm font-semibold text-foreground">Recent replays</h3>
        <div className="text-sm text-muted-foreground">
          No replays yet. Make sure session_recording is enabled in your PostHog project.
        </div>
      </div>
    );
  }

  return (
    <>
      <div className="rounded-lg bg-card p-4">
        <h3 className="mb-3 text-sm font-semibold text-foreground">Recent replays</h3>
        <ul className="divide-y">
          {items.map((rec) => (
            <li key={rec.id}>
              <button
                type="button"
                className="w-full px-2 py-2 text-left text-sm hover:bg-accent"
                onClick={() => setOpenId(rec.id)}
              >
                <div className="flex items-center justify-between">
                  <span className="font-mono text-xs text-muted-foreground">
                    {truncateId(rec.id)}
                  </span>
                  <span className="text-xs text-muted-foreground">
                    {formatRelativeTime(rec.startTime)}
                  </span>
                </div>
                <div className="text-xs text-muted-foreground">
                  Duration: {formatDuration(rec.durationSeconds)}
                </div>
              </button>
            </li>
          ))}
        </ul>
      </div>
      <ReplayModal recordingId={openId} onClose={() => setOpenId(null)} />
    </>
  );
}
```

Note: this preserves the existing card body. If the original file has additional content after `setOpenId(rec.id)` (truncated above when read during planning), preserve it verbatim — only the props signature and the removal of `useRecordings`/`enabled` change. Confirm by `git diff` before committing.

- [ ] **Step 2: Confirm no other caller of `RecentReplaysCard`**

Run: `cd packages/dashboard && grep -rn "RecentReplaysCard" src/`
Expected: matches in `RecentReplaysCard.tsx`, `AnalyticsPage.tsx`. AnalyticsPage gets deleted in Task 8 — for now its passing of `enabled` will TypeScript-fail. That's acceptable mid-feature; we fix it when `SessionReplayPage` (Task 7) takes over. To avoid breaking the build between tasks, also temporarily update the call site:

In `packages/dashboard/src/features/analytics/AnalyticsPage.tsx` (will be deleted in Task 8), replace:
```tsx
<RecentReplaysCard enabled />
```
with a stub block — the file is on its way out, so simply delete that line for now:
```tsx
{/* RecentReplaysCard moved to SessionReplayPage in Task 7 */}
```

- [ ] **Step 3: Typecheck**

Run: `cd packages/dashboard && npx tsc --noEmit`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add packages/dashboard/src/features/analytics/components/posthog/RecentReplaysCard.tsx packages/dashboard/src/features/analytics/AnalyticsPage.tsx
git commit -m "refactor(analytics): lift recordings fetching out of RecentReplaysCard"
```

---

## Task 3 — Create `AnalyticsConfigDialog`

**Files:**
- Create: `packages/dashboard/src/features/analytics/components/AnalyticsConfigDialog.tsx`

- [ ] **Step 1: Write the dialog**

Create `packages/dashboard/src/features/analytics/components/AnalyticsConfigDialog.tsx`:

```tsx
import { useState } from 'react';
import { Eye, EyeOff } from 'lucide-react';
import {
  Button,
  CopyButton,
  Input,
  MenuDialog,
  MenuDialogBody,
  MenuDialogCloseButton,
  MenuDialogContent,
  MenuDialogFooter,
  MenuDialogHeader,
  MenuDialogMain,
  MenuDialogNav,
  MenuDialogNavItem,
  MenuDialogNavList,
  MenuDialogSideNav,
  MenuDialogSideNavHeader,
  MenuDialogSideNavTitle,
  MenuDialogTitle,
} from '@insforge/ui';
import type { PosthogConnection } from '@insforge/shared-schemas';
import { DisconnectDialog } from './posthog/DisconnectDialog';

const ANALYTICS_SETUP_PROMPT =
  "I'm using InsForge as my backend platform. I want to add product analytics to this project. Read the current directory and use the InsForge skill to set up PostHog analytics for me.";

interface AnalyticsConfigDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  connection: PosthogConnection;
}

export function AnalyticsConfigDialog({
  open,
  onOpenChange,
  connection,
}: AnalyticsConfigDialogProps) {
  const [revealed, setRevealed] = useState(false);
  const [disconnecting, setDisconnecting] = useState(false);

  const maskedKey =
    connection.apiKey.length > 8
      ? `${connection.apiKey.slice(0, 4)}${'•'.repeat(connection.apiKey.length - 8)}${connection.apiKey.slice(-4)}`
      : '•'.repeat(connection.apiKey.length);

  return (
    <>
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
              <div className="flex flex-col gap-4">
                <ReadOnlyField label="Host" value={connection.host} />
                <ReadOnlyField label="Project ID" value={connection.posthogProjectId} />

                <div className="flex flex-col gap-1.5">
                  <label className="text-xs font-medium text-muted-foreground">Project API Key</label>
                  <div className="flex items-center gap-2">
                    <Input
                      readOnly
                      value={revealed ? connection.apiKey : maskedKey}
                      className="font-mono"
                    />
                    <Button
                      variant="ghost"
                      size="icon"
                      aria-label={revealed ? 'Hide API key' : 'Reveal API key'}
                      onClick={() => setRevealed((v) => !v)}
                    >
                      {revealed ? <EyeOff /> : <Eye />}
                    </Button>
                    <CopyButton text={connection.apiKey} showText={false} aria-label="Copy API key" />
                  </div>
                </div>

                <div className="flex flex-col gap-2 rounded border border-[var(--alpha-8)] bg-semantic-0 p-3">
                  <div className="flex items-center justify-between">
                    <div className="flex h-5 items-center rounded bg-[var(--alpha-8)] px-2">
                      <span className="text-xs font-medium leading-4 text-muted-foreground">
                        setup prompt
                      </span>
                    </div>
                    <CopyButton text={ANALYTICS_SETUP_PROMPT} showText={false} className="shrink-0" />
                  </div>
                  <p className="font-mono text-sm leading-6 text-foreground">
                    {ANALYTICS_SETUP_PROMPT}
                  </p>
                </div>
              </div>
            </MenuDialogBody>

            <MenuDialogFooter>
              <Button
                variant="ghost"
                className="text-destructive"
                onClick={() => setDisconnecting(true)}
              >
                Disconnect
              </Button>
            </MenuDialogFooter>
          </MenuDialogMain>
        </MenuDialogContent>
      </MenuDialog>

      <DisconnectDialog
        open={disconnecting}
        onClose={() => {
          setDisconnecting(false);
          onOpenChange(false);
        }}
      />
    </>
  );
}

function ReadOnlyField({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex flex-col gap-1.5">
      <label className="text-xs font-medium text-muted-foreground">{label}</label>
      <div className="flex items-center gap-2">
        <Input readOnly value={value} className="font-mono" />
        <CopyButton text={value} showText={false} aria-label={`Copy ${label}`} />
      </div>
    </div>
  );
}
```

(All styling uses existing tokens / classes already in `AnalyticsPage.tsx` and `ApiKeyCard.tsx`. The `bg-semantic-0` / `border-[var(--alpha-8)]` are the same vars used in `AnalyticsPage.tsx` today.)

- [ ] **Step 2: Typecheck**

Run: `cd packages/dashboard && npx tsc --noEmit`
Expected: PASS — `PosthogConnection` is already a known type from `@insforge/shared-schemas`.

- [ ] **Step 3: Commit**

```bash
git add packages/dashboard/src/features/analytics/components/AnalyticsConfigDialog.tsx
git commit -m "feat(analytics): add AnalyticsConfigDialog with connection details and setup prompt"
```

---

## Task 4 — Create `AnalyticsSidebar`

**Files:**
- Create: `packages/dashboard/src/features/analytics/components/AnalyticsSidebar.tsx`

- [ ] **Step 1: Write the sidebar**

Create `packages/dashboard/src/features/analytics/components/AnalyticsSidebar.tsx`:

```tsx
import { useState } from 'react';
import { Settings } from 'lucide-react';
import type { PosthogConnection } from '@insforge/shared-schemas';
import {
  FeatureSidebar,
  type FeatureSidebarHeaderButton,
  type FeatureSidebarListItem,
} from '#components';
import { AnalyticsConfigDialog } from './AnalyticsConfigDialog';

interface AnalyticsSidebarProps {
  connection: PosthogConnection | null;
}

export function AnalyticsSidebar({ connection }: AnalyticsSidebarProps) {
  const [settingsOpen, setSettingsOpen] = useState(false);
  const connected = connection !== null;

  const items: FeatureSidebarListItem[] = [
    {
      id: 'traffic',
      label: 'Traffic',
      href: '/dashboard/analytics/traffic',
      disabled: !connected,
    },
    {
      id: 'retention',
      label: 'User Retention',
      href: '/dashboard/analytics/retention',
      disabled: !connected,
    },
    {
      id: 'session-replay',
      label: 'Session Replay',
      href: '/dashboard/analytics/session-replay',
      disabled: !connected,
    },
  ];

  const headerButtons: FeatureSidebarHeaderButton[] = [
    {
      id: 'analytics-settings',
      label: 'Analytics Config',
      icon: Settings,
      onClick: () => setSettingsOpen(true),
      disabled: !connected,
    },
  ];

  return (
    <>
      <FeatureSidebar title="Analytics" items={items} headerButtons={headerButtons} />
      {connection && (
        <AnalyticsConfigDialog
          open={settingsOpen}
          onOpenChange={setSettingsOpen}
          connection={connection}
        />
      )}
    </>
  );
}
```

- [ ] **Step 2: Typecheck**

Run: `cd packages/dashboard && npx tsc --noEmit`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add packages/dashboard/src/features/analytics/components/AnalyticsSidebar.tsx
git commit -m "feat(analytics): add AnalyticsSidebar with disabled state and settings button"
```

---

## Task 5 — Create `TrafficPage`, `RetentionPage`, `SessionReplayPage`

Three tightly-related files in one commit.

**Files:**
- Create: `packages/dashboard/src/features/analytics/pages/TrafficPage.tsx`
- Create: `packages/dashboard/src/features/analytics/pages/RetentionPage.tsx`
- Create: `packages/dashboard/src/features/analytics/pages/SessionReplayPage.tsx`

- [ ] **Step 1: Create `TrafficPage`**

Create `packages/dashboard/src/features/analytics/pages/TrafficPage.tsx`:

```tsx
import { Info } from 'lucide-react';
import { TimeRangeSelector } from '#features/analytics/components/posthog/TimeRangeSelector';
import { KpiSectionWithTrend } from '#features/analytics/components/posthog/KpiSectionWithTrend';
import { BreakdownPanel } from '#features/analytics/components/posthog/BreakdownPanel';

export function TrafficPage() {
  return (
    <div className="flex flex-col gap-4 p-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold text-foreground">Traffic</h1>
        <TimeRangeSelector />
      </div>

      <div className="flex items-start gap-2 px-1 text-xs text-muted-foreground">
        <Info className="mt-0.5 size-3.5 shrink-0" />
        <p>
          Web Analytics aggregates session data with some delay. After connecting PostHog or
          capturing your first events, it may take a few hours for visitors, views, and sessions to
          appear here.
        </p>
      </div>

      <KpiSectionWithTrend enabled />

      <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
        <BreakdownPanel breakdown="Page" enabled />
        <BreakdownPanel breakdown="Country" enabled />
        <BreakdownPanel breakdown="DeviceType" enabled />
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Create `RetentionPage`**

Create `packages/dashboard/src/features/analytics/pages/RetentionPage.tsx`:

```tsx
import { TimeRangeSelector } from '#features/analytics/components/posthog/TimeRangeSelector';
import { RetentionCard } from '#features/analytics/components/posthog/RetentionCard';

export function RetentionPage() {
  return (
    <div className="flex flex-col gap-4 p-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold text-foreground">User Retention</h1>
        <TimeRangeSelector />
      </div>

      <RetentionCard enabled />
    </div>
  );
}
```

- [ ] **Step 3: Create `SessionReplayPage`**

Create `packages/dashboard/src/features/analytics/pages/SessionReplayPage.tsx`:

```tsx
import { useMemo, useState } from 'react';
import { PaginationControls } from '#components';
import { useRecordings } from '#features/analytics/hooks/useRecordings';
import { RecentReplaysCard } from '#features/analytics/components/posthog/RecentReplaysCard';
import { TimeRangeSelector } from '#features/analytics/components/posthog/TimeRangeSelector';

const WINDOW_SIZE = 50;
const PAGE_SIZE = 10;

export function SessionReplayPage() {
  const { data, isLoading, error } = useRecordings(WINDOW_SIZE, true);
  const [page, setPage] = useState(1);

  const allItems = data?.items ?? [];
  const totalPages = Math.max(1, Math.ceil(allItems.length / PAGE_SIZE));
  const pageItems = useMemo(
    () => allItems.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE),
    [allItems, page]
  );

  return (
    <div className="flex flex-col gap-4 p-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold text-foreground">Session Replay</h1>
        <TimeRangeSelector />
      </div>

      <RecentReplaysCard items={pageItems} isLoading={isLoading} error={error} />

      {allItems.length > PAGE_SIZE && (
        <PaginationControls
          currentPage={page}
          totalPages={totalPages}
          totalRecords={allItems.length}
          pageSize={PAGE_SIZE}
          recordLabel="replays"
          onPageChange={setPage}
        />
      )}
    </div>
  );
}
```

(Client-side pagination over a 50-record window: keeps the change scoped to the frontend. Backend `limit/offset` is a future enhancement noted in the spec.)

- [ ] **Step 4: Typecheck**

Run: `cd packages/dashboard && npx tsc --noEmit`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/dashboard/src/features/analytics/pages/
git commit -m "feat(analytics): add Traffic, Retention and Session Replay sub-pages"
```

---

## Task 6 — Create `AnalyticsLayout`

**Files:**
- Create: `packages/dashboard/src/features/analytics/components/AnalyticsLayout.tsx`

- [ ] **Step 1: Write the layout**

Create `packages/dashboard/src/features/analytics/components/AnalyticsLayout.tsx`:

```tsx
import { useEffect } from 'react';
import { Outlet } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import { ErrorState, LoadingState } from '#components';
import { useDashboardHost } from '#lib/config/DashboardHostContext';
import { useProjectId } from '#lib/hooks/useMetadata';
import { useToast } from '#lib/hooks/useToast';
import { TimeRangeProvider } from '../context/TimeRangeContext';
import { usePosthogConnection } from '../hooks/usePosthogConnection';
import { AnalyticsSidebar } from './AnalyticsSidebar';
import { EmptyConnectPanel } from './posthog/EmptyConnectPanel';

export default function AnalyticsLayout() {
  const conn = usePosthogConnection();
  const { projectId, isLoading: projectIdLoading, error: projectIdError } = useProjectId();
  const qc = useQueryClient();
  const { showToast } = useToast();
  const { subscribePosthogConnectionStatus } = useDashboardHost();

  useEffect(() => {
    if (!subscribePosthogConnectionStatus) return;
    return subscribePosthogConnectionStatus((e) => {
      if (e.status === 'connected') {
        void qc.invalidateQueries({ queryKey: ['posthog'] });
        return;
      }
      if (e.status === 'error') {
        showToast(
          e.reason
            ? `PostHog connection failed: ${e.reason}`
            : 'PostHog connection failed. Please try again.',
          'error'
        );
        return;
      }
      if (e.status === 'cancelled') {
        showToast('PostHog connection cancelled.', 'info');
      }
    });
  }, [qc, showToast, subscribePosthogConnectionStatus]);

  const connection = conn.data ?? null;

  return (
    <TimeRangeProvider>
      <div className="flex h-full min-h-0 overflow-hidden bg-[rgb(var(--semantic-1))]">
        <AnalyticsSidebar connection={connection} />
        <div className="min-w-0 flex-1 overflow-auto">
          {renderMain({
            conn,
            connection,
            projectId,
            projectIdLoading,
            projectIdError,
          })}
        </div>
      </div>
    </TimeRangeProvider>
  );
}

function renderMain({
  conn,
  connection,
  projectId,
  projectIdLoading,
  projectIdError,
}: {
  conn: ReturnType<typeof usePosthogConnection>;
  connection: ReturnType<typeof usePosthogConnection>['data'] | null;
  projectId: string | null;
  projectIdLoading: boolean;
  projectIdError: unknown;
}) {
  if (conn.isLoading || projectIdLoading) {
    return <LoadingState />;
  }
  if (conn.isError) {
    return <ErrorState title="Failed to load PostHog connection" />;
  }
  if (!connection) {
    if (projectIdError || !projectId) {
      return <ErrorState title="Failed to load project ID" />;
    }
    return (
      <div className="flex h-full items-center justify-center p-6">
        <div className="w-full max-w-md">
          <EmptyConnectPanel projectId={projectId} />
        </div>
      </div>
    );
  }
  return <Outlet />;
}
```

(Layout uses the same `bg-[rgb(var(--semantic-1))]` wrapper as `AuthenticationLayout` — exact-class match for visual parity with the surrounding dashboard chrome.)

- [ ] **Step 2: Verify `ErrorState` / `LoadingState` prop signatures**

Run: `cd packages/dashboard && head -40 src/components/ErrorState.tsx src/components/LoadingState.tsx`
Expected: Confirms `ErrorState` accepts `title` (and possibly `message`) and `LoadingState` is parameterless. **If the props don't match what's used above, adjust the JSX in Step 1 to the actual props of these components before typechecking.**

- [ ] **Step 3: Typecheck**

Run: `cd packages/dashboard && npx tsc --noEmit`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add packages/dashboard/src/features/analytics/components/AnalyticsLayout.tsx
git commit -m "feat(analytics): add AnalyticsLayout with connection-aware empty state"
```

---

## Task 7 — Wire the router and delete superseded files

**Files:**
- Modify: `packages/dashboard/src/router/AppRoutes.tsx`
- Modify: `packages/dashboard/src/features/analytics/index.ts`
- Delete: `packages/dashboard/src/features/analytics/AnalyticsPage.tsx`
- Delete: `packages/dashboard/src/features/analytics/components/posthog/ApiKeyCard.tsx`
- Delete: `packages/dashboard/src/features/analytics/components/posthog/ConnectStatusBar.tsx`

- [ ] **Step 1: Update `AppRoutes.tsx`**

Edit `packages/dashboard/src/router/AppRoutes.tsx`:

1. Remove the existing import:
   ```ts
   import { AnalyticsPage } from '#features/analytics';
   ```

2. Add new imports (in alphabetical position with the other Layout imports — currently around lines 28–55):
   ```ts
   import AnalyticsLayout from '#features/analytics/components/AnalyticsLayout';
   import { TrafficPage } from '#features/analytics/pages/TrafficPage';
   import { RetentionPage } from '#features/analytics/pages/RetentionPage';
   import { SessionReplayPage } from '#features/analytics/pages/SessionReplayPage';
   ```

3. Replace the single Analytics route line (currently around line 145):
   ```tsx
   {isCloudHosting && <Route path="/dashboard/analytics" element={<AnalyticsPage />} />}
   ```
   with the nested layout:
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
   (`Navigate` is already imported in this file — used by `payments` / `realtime` / `deployments` for the same index-redirect pattern.)

- [ ] **Step 2: Clear out `features/analytics/index.ts`**

Replace the contents of `packages/dashboard/src/features/analytics/index.ts` with:
```ts
// Router imports AnalyticsLayout from ./components/AnalyticsLayout directly.
// No barrel exports needed for this feature (matches features/realtime, features/payments).
export {};
```

- [ ] **Step 3: Delete superseded files**

Run:
```bash
git rm packages/dashboard/src/features/analytics/AnalyticsPage.tsx
git rm packages/dashboard/src/features/analytics/components/posthog/ApiKeyCard.tsx
git rm packages/dashboard/src/features/analytics/components/posthog/ConnectStatusBar.tsx
```

- [ ] **Step 4: Confirm no dangling imports**

Run:
```bash
cd packages/dashboard && grep -rn "AnalyticsPage\|ApiKeyCard\|ConnectStatusBar" src/
```
Expected: no matches.

- [ ] **Step 5: Typecheck and build**

Run: `cd packages/dashboard && npx tsc --noEmit`
Expected: PASS.

Run: `cd packages/dashboard && npm run build`
Expected: PASS (or the project's standard build command — confirm via `cat package.json | grep \"build\":`).

- [ ] **Step 6: Commit**

```bash
git add packages/dashboard/src/router/AppRoutes.tsx packages/dashboard/src/features/analytics/index.ts
git commit -m "feat(analytics): wire nested Analytics routes and remove single-page implementation"
```

---

## Task 8 — Manual verification in the dev server

**Files:** none — manual.

- [ ] **Step 1: Run the dashboard dev server**

Run from repo root: `npm run dev` (or the project's standard dev command — confirm via `cat package.json | grep \"dev\":`).

- [ ] **Step 2: Verify disconnected state**

Open `http://localhost:3000/dashboard/analytics` (or the local URL printed by the dev server) on a cloud-hosted dashboard with PostHog *not* connected.

Expected:
- Sidebar shows `Analytics` header + 3 sub-items rendered muted with `aria-disabled` (inspect DOM)
- Gear icon in sidebar header is visibly disabled
- Clicking any sub-item does nothing; URL stays at `/dashboard/analytics/traffic` (after the index redirect)
- Main area shows the `Connect PostHog` empty panel centered
- Clicking `Connect PostHog` triggers `onConnectPosthog(projectId)` as before

- [ ] **Step 3: Verify connected state**

Trigger a connect (via the host) or temporarily stub `usePosthogConnection` to return mock data.

Expected:
- Sidebar items enabled, clickable
- `/dashboard/analytics` redirects to `/dashboard/analytics/traffic`
- Traffic page renders header + lag callout + KPI + 3 breakdown panels (3 columns at `md+`)
- `/dashboard/analytics/retention` renders `RetentionCard` full-width
- `/dashboard/analytics/session-replay` renders the replays list (top 10) with pagination at the bottom if there are >10 recordings

- [ ] **Step 4: Verify Settings dialog**

Click the gear icon in the sidebar header.

Expected:
- Modal opens with left side-nav (`Analytics Config` / `Connection`) + right form
- Host / Project ID / API key fields read-only, with show toggle on the key and copy buttons on all three
- Setup-with-Prompt block at the bottom with copy
- Footer `Disconnect` button opens the existing `DisconnectDialog` confirm
- Confirming disconnect closes both dialogs and returns to the disconnected layout

- [ ] **Step 5: Optional — Run the existing unit tests**

Run: `cd packages/dashboard && npx vitest run`
Expected: PASS (existing tests not affected; new `FeatureSidebar` test passes; new `format.test.ts` still passes).

---

## Self-Review

**Spec coverage** — walking the spec section by section:
- Routes (layout + index + 3 sub-routes) → Task 7 ✓
- Components (Layout / Sidebar / ConfigDialog / 3 pages) → Tasks 3–6 ✓
- `FeatureSidebar` `disabled` field → Task 1 ✓
- Disconnected behavior (sidebar items disabled, gear disabled, EmptyConnectPanel in main, deep-link safety) → Task 6 (Layout) + Task 4 (Sidebar) + Task 7 (routes still allow URL) ✓
- Connection toast effect lifted into Layout → Task 6 ✓
- Setup prompt + ConnectStatusBar + ApiKeyCard moved into ConfigDialog → Task 3 ✓
- Files to DELETE (AnalyticsPage / ApiKeyCard / ConnectStatusBar) → Task 7 ✓
- `useRecordings` pagination consideration → Task 5 SessionReplayPage uses client-side paging over a 50-record window (spec's "fallback to top-N list" extended into a reasonable client-paged window); no `useRecordings.ts` change ✓
- `isCloudHosting` route gate preserved → Task 7 (the `{isCloudHosting && ...}` wrap stays) ✓
- No hex / rgba — all tokens / vars only → checked in Tasks 1 and 3; consistent with existing files ✓

**Placeholder scan:**
- Step 2 of Task 6 says "If the props don't match… adjust." — this is the only conditional. It's a real verification step, not a TODO; the action is concrete (read the file, match the actual prop name). Acceptable.
- No "TBD" / "handle edge cases" / "similar to Task N" / "implement later" anywhere.

**Type consistency:**
- `PosthogConnection` used in both `AnalyticsConfigDialog` (Task 3) and `AnalyticsSidebar` (Task 4) — same import from `@insforge/shared-schemas`, same shape.
- `RecentReplaysCardProps` (Task 2) defines `items: PosthogRecording[]` — used by `SessionReplayPage` (Task 5) via `pageItems` from `data?.items ?? []`. Consistent.
- `usePosthogConnection` return shape used consistently in Task 6's Layout.

No issues found.
