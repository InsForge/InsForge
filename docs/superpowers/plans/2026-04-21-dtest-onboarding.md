# D Test Onboarding Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a `d_test` variant of the dashboard home that replaces C test's Get-Started + Prompt Stepper flow with an install-first "Install InsForge" client picker and a simplified 4-metric connected dashboard, gated behind the existing PostHog `dashboard-v3-experiment` feature flag.

**Architecture:** `DTestDashboardPage` acts as the entry point and picks between three in-page views (`InstallInsForgePage`, `ClientDetailPage`, `DTestConnectedDashboard`) via a URL-backed `view` state plus a session `selectedClient`. Install ↔ Dashboard transitions are two-way: `[X]` on Install persists a per-project dismissal flag and returns to Dashboard; top-nav Connect sets `?view=install` to return to Install. Tile detail pages reuse existing components (`NewCLISection`, `MCPSection` with a new `initialAgentId` prop, `ConnectionStringSectionV2`, `APIKeysSectionV2`) rather than reimplementing them.

**Tech Stack:** React 18, TypeScript, react-router `useSearchParams`, Vite, Tailwind + project CSS tokens, PostHog feature flags. No test framework wired up in `packages/dashboard`; verification is `npm run typecheck` + `npm run lint` + manual dev-server walkthrough.

**Spec:** `docs/superpowers/specs/2026-04-21-dtest-onboarding-design.md`

**Commit policy:** Do **not** commit during execution. Each task ends at `typecheck + lint pass`; all changes stay in the working tree. The user commits manually after they have reviewed the full change set.

---

## File Map

| File | Purpose | Create/Modify |
|------|---------|---------------|
| `packages/dashboard/src/features/dashboard/components/MetricCard.tsx` | Shared metric card (lifted from `CTestDashboardPage`) | Create |
| `packages/dashboard/src/features/dashboard/pages/CTestDashboardPage.tsx` | Consume shared `MetricCard` | Modify |
| `packages/dashboard/src/features/dashboard/components/connect/MCPSection.tsx` | Accept `initialAgentId` prop | Modify |
| `packages/dashboard/src/features/dashboard/components/dtest/clientRegistry.tsx` | Tile metadata (id, label, icon, kind, `mcpAgentId`) | Create |
| `packages/dashboard/src/features/dashboard/components/dtest/useDTestView.ts` | URL-backed view state + localStorage dismissal flag + selectedClient | Create |
| `packages/dashboard/src/features/dashboard/components/dtest/ClientTile.tsx` | Reusable tile with icon, label, Install button | Create |
| `packages/dashboard/src/features/dashboard/components/dtest/InstallInsForgePage.tsx` | All-Clients page: 3 sections + `[X]` | Create |
| `packages/dashboard/src/features/dashboard/components/dtest/ClientDetailPage.tsx` | Detail shell: back button + icon/title + CLI/MCP toggle + content | Create |
| `packages/dashboard/src/features/dashboard/components/dtest/DTestConnectedDashboard.tsx` | Connected dashboard: header + 4 metric cards | Create |
| `packages/dashboard/src/features/dashboard/pages/DTestDashboardPage.tsx` | Entry; switches views via `useDTestView` | Create |
| `packages/dashboard/src/router/AppRoutes.tsx` | Add `d_test` branch | Modify |
| `packages/dashboard/src/layout/AppHeader.tsx` | Variant-aware Connect button (`?view=install` when `d_test` on `/dashboard`) | Modify |

---

## Task 1: Lift `MetricCard` to a shared component

**Why first:** Zero-risk refactor, both C test and D test depend on it. Lands on its own commit so any regression is bisectable.

**Files:**
- Create: `packages/dashboard/src/features/dashboard/components/MetricCard.tsx`
- Modify: `packages/dashboard/src/features/dashboard/pages/CTestDashboardPage.tsx`

- [ ] **Step 1: Create the shared `MetricCard` file**

```tsx
// packages/dashboard/src/features/dashboard/components/MetricCard.tsx
import { ExternalLink } from 'lucide-react';
import { type ReactNode } from 'react';

export interface MetricCardProps {
  label: string;
  value: string;
  subValueLeft?: string;
  subValueRight?: string;
  icon: ReactNode;
  onNavigate?: () => void;
}

export function MetricCard({
  label,
  value,
  subValueLeft,
  subValueRight,
  icon,
  onNavigate,
}: MetricCardProps) {
  return (
    <div className="flex min-w-0 flex-1 flex-col overflow-hidden rounded border border-[var(--alpha-8)] bg-card">
      <div className="flex h-[120px] flex-col p-4">
        <div className="flex h-[22px] items-center gap-1.5">
          <div className="flex h-5 w-5 shrink-0 items-center justify-center text-muted-foreground">
            {icon}
          </div>
          <p className="flex-1 text-[13px] leading-[22px] text-muted-foreground">{label}</p>
          {onNavigate && (
            <button
              type="button"
              onClick={onNavigate}
              aria-label={`Open ${label}`}
              className="flex shrink-0 items-center justify-center text-muted-foreground hover:text-foreground"
            >
              <ExternalLink className="h-5 w-5" />
            </button>
          )}
        </div>
        <div className="mt-[38px] flex items-baseline justify-between">
          <div className="flex items-baseline gap-1">
            <p className="text-[20px] font-medium leading-7 text-foreground">{value}</p>
            {subValueLeft && (
              <span className="text-[13px] leading-[22px] text-muted-foreground">
                {subValueLeft}
              </span>
            )}
          </div>
          {subValueRight && (
            <span className="text-[13px] leading-[22px] text-muted-foreground">
              {subValueRight}
            </span>
          )}
        </div>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Replace the inline `MetricCard` in `CTestDashboardPage`**

Delete the local `MetricCardProps` interface and `MetricCard` function (currently `CTestDashboardPage.tsx:99-153`). Add this import at the top alongside other component imports:

```tsx
import { MetricCard } from '../components/MetricCard';
```

Remove these lines from the import list: `Skeleton` usage remains, but replace the `MetricCard` import path if the prior version was local.

Existing `<MetricCard ... />` JSX sites elsewhere in the file stay unchanged.

- [ ] **Step 3: Typecheck & lint**

```bash
npm --prefix packages/dashboard run typecheck
npm --prefix packages/dashboard run lint
```

Expected: clean. Leave changes in the working tree.

---

## Task 2: Extend shared install sections for D test reuse

**Why:** D test detail pages need two backward-compatible prop additions:
1. `MCPSection` must accept `initialAgentId` to preselect the agent that matches the tile.
2. `NewCLISection` must accept a `hideHeader` flag so D test can suppress the internal "Get Started" title (parent already renders the agent title) **without** triggering the C test `isCTest` code path that appends an empty Step 4.

**Files:**
- Modify: `packages/dashboard/src/features/dashboard/components/connect/MCPSection.tsx`
- Modify: `packages/dashboard/src/features/dashboard/components/connect/NewCLISection.tsx`

- [ ] **Step 1: Extend `MCPSectionProps`**

In `MCPSection.tsx`, update `MCPSectionProps`:

```tsx
interface MCPSectionProps {
  apiKey: string;
  appUrl: string;
  isLoading?: boolean;
  className?: string;
  onAgentChange?: (agent: MCPAgent) => void;
  /** Preselect this agent by id on mount. Falls back to MCP_AGENTS[0] if unknown. */
  initialAgentId?: string;
}
```

- [ ] **Step 2: Use `initialAgentId` to seed `useState`**

Replace the existing `useState` init:

```tsx
const [selectedAgent, setSelectedAgent] = useState<MCPAgent>(
  () => MCP_AGENTS.find((a) => a.id === initialAgentId) ?? MCP_AGENTS[0]
);
```

Destructure `initialAgentId` from props alongside the others in the function signature.

- [ ] **Step 3: Add `hideHeader` prop to `NewCLISection`**

In `NewCLISection.tsx`, update `NewCLISectionProps`:

```tsx
interface NewCLISectionProps {
  className?: string;
  isCTest?: boolean;
  /** Hide the internal "Get Started" header. Parent should already render a title. */
  hideHeader?: boolean;
}
```

Destructure `hideHeader = false` alongside `isCTest` in the function signature. Change the existing header render guard from `{!isCTest && (...)}` to:

```tsx
{!isCTest && !hideHeader && (
  <div className="flex max-w-[640px] flex-col gap-3">
    <h3 className="text-2xl font-medium leading-8 text-foreground">Get Started</h3>
    <p className="text-sm leading-6 text-muted-foreground">
      Run these commands to create a new web app with your credentials.
    </p>
  </div>
)}
```

The `isCTest`-gated Step 4 block stays unchanged so C test's behavior is preserved.

- [ ] **Step 4: Typecheck & lint**

```bash
npm --prefix packages/dashboard run typecheck
npm --prefix packages/dashboard run lint
```

Expected: clean. Leave changes in the working tree.

---

## Task 3: Create the client registry

**Why:** Single source of truth for tile metadata so the grid, the featured section, and the detail page stay in sync.

**Files:**
- Create: `packages/dashboard/src/features/dashboard/components/dtest/clientRegistry.tsx`

- [ ] **Step 1: Write the registry**

```tsx
// packages/dashboard/src/features/dashboard/components/dtest/clientRegistry.tsx
import { type ReactNode } from 'react';
import { Database, MoreHorizontal } from 'lucide-react';
import KeyHorizontalIcon from '../../../../assets/icons/key_horizontal.svg?react';
import ClaudeLogo from '../../../../assets/logos/claude_code.svg?react';
import OpenAILogo from '../../../../assets/logos/openai.svg?react';
import CursorLogo from '../../../../assets/logos/cursor.svg?react';
import CopilotLogo from '../../../../assets/logos/copilot.svg?react';
import TraeLogo from '../../../../assets/logos/trae.svg?react';
import AntigravityLogo from '../../../../assets/logos/antigravity.png';

export type ClientId =
  | 'claude-code'
  | 'codex'
  | 'antigravity'
  | 'cursor'
  | 'copilot'
  | 'trae'
  | 'other'
  | 'connection-string'
  | 'api-keys';

export type ClientKind = 'agent' | 'direct-connect';

export interface ClientEntry {
  id: ClientId;
  label: string;
  icon: ReactNode;
  detailIcon: ReactNode;
  kind: ClientKind;
  /** MCP dropdown preselection inside the detail page. Omit for 'other' & direct-connect. */
  mcpAgentId?: string;
}

const iconTile = (node: ReactNode) => <span className="flex h-8 w-8 items-center justify-center">{node}</span>;

export const CLIENT_ENTRIES: Record<ClientId, ClientEntry> = {
  'claude-code': {
    id: 'claude-code',
    label: 'Claude Code',
    icon: iconTile(<ClaudeLogo className="h-8 w-8" />),
    detailIcon: <ClaudeLogo className="h-8 w-8" />,
    kind: 'agent',
    mcpAgentId: 'claude-code',
  },
  codex: {
    id: 'codex',
    label: 'Codex',
    icon: iconTile(<OpenAILogo className="h-8 w-8 dark:text-white" />),
    detailIcon: <OpenAILogo className="h-8 w-8 dark:text-white" />,
    kind: 'agent',
    mcpAgentId: 'codex',
  },
  antigravity: {
    id: 'antigravity',
    label: 'Antigravity',
    icon: iconTile(
      <img src={AntigravityLogo} alt="Antigravity" className="h-8 w-8 object-contain" />
    ),
    detailIcon: <img src={AntigravityLogo} alt="Antigravity" className="h-8 w-8 object-contain" />,
    kind: 'agent',
    mcpAgentId: 'antigravity',
  },
  cursor: {
    id: 'cursor',
    label: 'Cursor',
    icon: iconTile(<CursorLogo className="h-8 w-8" />),
    detailIcon: <CursorLogo className="h-8 w-8" />,
    kind: 'agent',
    mcpAgentId: 'cursor',
  },
  copilot: {
    id: 'copilot',
    label: 'Copilot',
    icon: iconTile(<CopilotLogo className="h-8 w-8 dark:text-white" />),
    detailIcon: <CopilotLogo className="h-8 w-8 dark:text-white" />,
    kind: 'agent',
    mcpAgentId: 'copilot',
  },
  trae: {
    id: 'trae',
    label: 'Trae',
    icon: iconTile(<TraeLogo className="h-8 w-8" />),
    detailIcon: <TraeLogo className="h-8 w-8" />,
    kind: 'agent',
    mcpAgentId: 'trae',
  },
  other: {
    id: 'other',
    label: 'Other Agents',
    icon: iconTile(<MoreHorizontal className="h-6 w-6 text-muted-foreground" />),
    detailIcon: <MoreHorizontal className="h-8 w-8 text-muted-foreground" />,
    kind: 'agent',
    // intentionally no mcpAgentId → MCPSection falls back to MCP_AGENTS[0]
  },
  'connection-string': {
    id: 'connection-string',
    label: 'Connection String',
    icon: iconTile(<Database className="h-6 w-6 text-foreground" />),
    detailIcon: <Database className="h-8 w-8 text-foreground" />,
    kind: 'direct-connect',
  },
  'api-keys': {
    id: 'api-keys',
    label: 'API Keys',
    icon: iconTile(<KeyHorizontalIcon className="h-6 w-6 text-foreground" />),
    detailIcon: <KeyHorizontalIcon className="h-8 w-8 text-foreground" />,
    kind: 'direct-connect',
  },
};

/** Ordered ids for the "Install in Coding Agent" grid (displayed row-by-row, 2 per row). */
export const CODING_AGENT_GRID_IDS: ClientId[] = [
  'claude-code',
  'codex',
  'antigravity',
  'cursor',
  'copilot',
  'trae',
  'other',
];

export const FEATURED_CLAUDE_CODE_ID: ClientId = 'claude-code';

export const DIRECT_CONNECT_IDS: ClientId[] = ['connection-string', 'api-keys'];
```

- [ ] **Step 2: Typecheck & lint**

```bash
npm --prefix packages/dashboard run typecheck
npm --prefix packages/dashboard run lint
```

Expected: clean. Leave changes in the working tree.

---

## Task 4: Create the `useDTestView` hook

**Why:** Centralizes the URL-backed view state, the per-project dismissal flag, and the session `selectedClient`. Keeps the entry page thin.

**Files:**
- Create: `packages/dashboard/src/features/dashboard/components/dtest/useDTestView.ts`

- [ ] **Step 1: Write the hook**

```ts
// packages/dashboard/src/features/dashboard/components/dtest/useDTestView.ts
import { useCallback, useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import type { ClientId } from './clientRegistry';

export type DTestView = 'install' | 'dashboard';

const getDismissKey = (projectId: string | null | undefined) =>
  `insforge-dtest-install-dismissed-${projectId || 'default'}`;

function readDismissed(key: string): boolean {
  try {
    return localStorage.getItem(key) === 'true';
  } catch {
    return false;
  }
}

function writeDismissed(key: string, value: boolean): void {
  try {
    if (value) {
      localStorage.setItem(key, 'true');
    } else {
      localStorage.removeItem(key);
    }
  } catch {
    // noop (privacy mode / SSR)
  }
}

interface UseDTestViewArgs {
  hasCompletedOnboarding: boolean;
  projectId: string | null | undefined;
}

export function useDTestView({ hasCompletedOnboarding, projectId }: UseDTestViewArgs) {
  const [params, setParams] = useSearchParams();
  const dismissKey = getDismissKey(projectId);
  const [selectedClient, setSelectedClient] = useState<ClientId | null>(null);

  // Persist dismissal the first time onboarding completes, so a later loss of
  // MCP usage history does not bounce the user back to the install page.
  useEffect(() => {
    if (projectId && hasCompletedOnboarding && !readDismissed(dismissKey)) {
      writeDismissed(dismissKey, true);
    }
  }, [hasCompletedOnboarding, projectId, dismissKey]);

  const view: DTestView = useMemo(() => {
    const urlView = params.get('view');
    if (urlView === 'install') return 'install';
    if (urlView === 'dashboard') return 'dashboard';
    // no param → compute default once per render
    if (readDismissed(dismissKey)) return 'dashboard';
    return hasCompletedOnboarding ? 'dashboard' : 'install';
  }, [params, hasCompletedOnboarding, dismissKey]);

  const setView = useCallback(
    (v: DTestView, options?: { dismiss?: boolean }) => {
      const next = new URLSearchParams(params);
      if (v === 'install') {
        next.set('view', 'install');
      } else {
        next.delete('view');
      }
      setParams(next, { replace: true });
      if (v === 'dashboard') {
        setSelectedClient(null);
      }
      if (options?.dismiss && projectId) {
        writeDismissed(dismissKey, true);
      }
    },
    [params, setParams, projectId, dismissKey]
  );

  return {
    view,
    setView,
    selectedClient,
    setSelectedClient,
  };
}
```

- [ ] **Step 2: Typecheck & lint**

```bash
npm --prefix packages/dashboard run typecheck
npm --prefix packages/dashboard run lint
```

Expected: clean. Leave changes in the working tree.

---

## Task 5: Create `ClientTile`

**Why:** Shared tile visual used by all three sections on the Install page.

**Files:**
- Create: `packages/dashboard/src/features/dashboard/components/dtest/ClientTile.tsx`

- [ ] **Step 1: Write the tile**

```tsx
// packages/dashboard/src/features/dashboard/components/dtest/ClientTile.tsx
import { Button } from '@insforge/ui';
import { type ReactNode } from 'react';

interface ClientTileProps {
  icon: ReactNode;
  label: string;
  onClick: () => void;
}

export function ClientTile({ icon, label, onClick }: ClientTileProps) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="flex flex-1 min-w-0 items-center gap-3 rounded border border-[var(--alpha-8)] bg-toast p-3 text-left transition-colors hover:bg-[var(--alpha-12)]"
    >
      <div className="shrink-0">{icon}</div>
      <span className="min-w-0 flex-1 text-sm leading-5 text-foreground">{label}</span>
      <Button
        type="button"
        size="sm"
        variant="secondary"
        onClick={(e) => {
          e.stopPropagation();
          onClick();
        }}
        className="h-7 rounded border-[var(--alpha-8)] bg-card px-2 text-sm font-medium text-foreground"
      >
        Install
      </Button>
    </button>
  );
}
```

- [ ] **Step 2: Typecheck & lint**

```bash
npm --prefix packages/dashboard run typecheck
npm --prefix packages/dashboard run lint
```

Expected: clean. Leave changes in the working tree.

---

## Task 6: Create `InstallInsForgePage`

**Why:** The All-Clients main view. Composes three sections using the registry and `ClientTile`.

**Files:**
- Create: `packages/dashboard/src/features/dashboard/components/dtest/InstallInsForgePage.tsx`

- [ ] **Step 1: Write the page**

```tsx
// packages/dashboard/src/features/dashboard/components/dtest/InstallInsForgePage.tsx
import { X } from 'lucide-react';
import { Button } from '@insforge/ui';
import { ClientTile } from './ClientTile';
import {
  CLIENT_ENTRIES,
  CODING_AGENT_GRID_IDS,
  DIRECT_CONNECT_IDS,
  FEATURED_CLAUDE_CODE_ID,
  type ClientId,
} from './clientRegistry';

interface InstallInsForgePageProps {
  onSelectClient: (id: ClientId) => void;
  onDismiss: () => void;
}

export function InstallInsForgePage({ onSelectClient, onDismiss }: InstallInsForgePageProps) {
  const featured = CLIENT_ENTRIES[FEATURED_CLAUDE_CODE_ID];
  const gridEntries = CODING_AGENT_GRID_IDS.map((id) => CLIENT_ENTRIES[id]);
  const directEntries = DIRECT_CONNECT_IDS.map((id) => CLIENT_ENTRIES[id]);

  return (
    <main className="h-full min-h-0 min-w-0 overflow-y-auto bg-semantic-1">
      <div className="mx-auto flex w-full max-w-[640px] flex-col gap-6 px-6 pt-16 pb-10">
        {/* Title row */}
        <div className="flex items-center justify-between">
          <h1 className="text-[28px] font-medium leading-10 text-foreground">Install InsForge</h1>
          <Button
            type="button"
            size="sm"
            variant="secondary"
            onClick={onDismiss}
            aria-label="Close install page"
            className="h-8 w-8 rounded border border-[var(--alpha-8)] p-0 text-muted-foreground hover:text-foreground"
          >
            <X className="h-5 w-5" />
          </Button>
        </div>

        {/* Section 1: Setup in Claude Code */}
        <section className="flex flex-col gap-3 rounded border border-[var(--alpha-8)] bg-card p-6">
          <h2 className="text-base font-medium leading-7 text-foreground">Setup In Claude Code</h2>
          <div className="flex gap-3">
            <ClientTile
              icon={featured.icon}
              label={featured.label}
              onClick={() => onSelectClient(featured.id)}
            />
          </div>
        </section>

        {/* Section 2: Install in Coding Agent */}
        <section className="flex flex-col gap-3 rounded border border-[var(--alpha-8)] bg-card p-6">
          <h2 className="text-base font-medium leading-7 text-foreground">
            Install in Coding Agent
          </h2>
          <div className="grid grid-cols-2 gap-3">
            {gridEntries.map((entry) => (
              <ClientTile
                key={entry.id}
                icon={entry.icon}
                label={entry.label}
                onClick={() => onSelectClient(entry.id)}
              />
            ))}
          </div>
        </section>

        {/* Section 3: Direct Connect */}
        <section className="flex flex-col gap-3 rounded border border-[var(--alpha-8)] bg-card p-6">
          <div>
            <h2 className="text-base font-medium leading-7 text-foreground">Direct Connect</h2>
            <p className="text-sm leading-5 text-muted-foreground">
              Connect your database or app directly with connection credentials.
            </p>
          </div>
          <div className="flex gap-3">
            {directEntries.map((entry) => (
              <button
                key={entry.id}
                type="button"
                onClick={() => onSelectClient(entry.id)}
                className="flex flex-1 flex-col items-center justify-center gap-3 rounded border border-[var(--alpha-8)] bg-toast py-6 transition-colors hover:bg-[var(--alpha-12)]"
              >
                <div className="flex h-6 w-6 items-center justify-center">{entry.icon}</div>
                <span className="text-[13px] leading-[18px] text-foreground">{entry.label}</span>
              </button>
            ))}
          </div>
        </section>
      </div>
    </main>
  );
}
```

- [ ] **Step 2: Typecheck & lint**

```bash
npm --prefix packages/dashboard run typecheck
npm --prefix packages/dashboard run lint
```

Expected: clean. Leave changes in the working tree.

---

## Task 7: Create `ClientDetailPage`

**Why:** Detail shell shared by all tile types. Contains the CLI/MCP toggle for agents and embeds the right existing section component based on the client kind.

**Files:**
- Create: `packages/dashboard/src/features/dashboard/components/dtest/ClientDetailPage.tsx`

- [ ] **Step 1: Write the page**

```tsx
// packages/dashboard/src/features/dashboard/components/dtest/ClientDetailPage.tsx
import { useState } from 'react';
import { ArrowLeft } from 'lucide-react';
import { Button } from '@insforge/ui';
import { NewCLISection } from '../connect/NewCLISection';
import { MCPSection } from '../connect/MCPSection';
import { ConnectionStringSectionV2 } from '../connect/ConnectionStringSectionV2';
import { APIKeysSectionV2 } from '../connect/APIKeysSectionV2';
import { CLIENT_ENTRIES, type ClientId } from './clientRegistry';
import { useApiKey } from '../../../../lib/hooks/useMetadata';
import { useAnonToken } from '../../../auth/hooks/useAnonToken';
import { getBackendUrl } from '../../../../lib/utils/utils';
import { cn } from '../../../../lib/utils/utils';

interface ClientDetailPageProps {
  clientId: ClientId;
  onBack: () => void;
}

type DetailTab = 'cli' | 'mcp';

export function ClientDetailPage({ clientId, onBack }: ClientDetailPageProps) {
  const entry = CLIENT_ENTRIES[clientId];
  const { apiKey, isLoading: isApiKeyLoading } = useApiKey();
  const { anonToken } = useAnonToken();
  const [tab, setTab] = useState<DetailTab>('cli');

  const appUrl = getBackendUrl();
  const displayApiKey = isApiKeyLoading ? 'ik_' + '*'.repeat(32) : apiKey || '';

  return (
    <main className="h-full min-h-0 min-w-0 overflow-y-auto bg-semantic-1">
      <div className="mx-auto flex w-full max-w-[640px] flex-col gap-6 px-6 pt-10 pb-10">
        {/* Back */}
        <Button
          type="button"
          variant="ghost"
          size="sm"
          onClick={onBack}
          className="w-fit gap-1 px-1.5 text-sm text-muted-foreground hover:text-foreground"
        >
          <ArrowLeft className="h-5 w-5" />
          All Clients
        </Button>

        {/* Title row */}
        <div className="flex items-center gap-3">
          <div className="h-8 w-8 shrink-0">{entry.detailIcon}</div>
          <h1 className="text-[28px] font-medium leading-10 text-foreground">{entry.label}</h1>
        </div>

        {/* Body per kind */}
        {entry.kind === 'agent' ? (
          <>
            {/* CLI/MCP toggle */}
            <div className="flex w-full overflow-hidden rounded border border-[var(--alpha-8)] bg-[var(--alpha-4)]">
              <TabButton active={tab === 'cli'} onClick={() => setTab('cli')} label="CLI" />
              <TabButton active={tab === 'mcp'} onClick={() => setTab('mcp')} label="MCP" />
            </div>

            <div className="rounded border border-[var(--alpha-8)] bg-card p-6">
              {tab === 'cli' ? (
                <NewCLISection hideHeader className="max-w-full border-0 bg-transparent p-0" />
              ) : (
                <MCPSection
                  apiKey={displayApiKey}
                  appUrl={appUrl}
                  isLoading={isApiKeyLoading}
                  initialAgentId={entry.mcpAgentId}
                />
              )}
            </div>
          </>
        ) : clientId === 'connection-string' ? (
          <ConnectionStringSectionV2 />
        ) : (
          <APIKeysSectionV2
            apiKey={displayApiKey}
            anonKey={anonToken || ''}
            appUrl={appUrl}
            isLoading={isApiKeyLoading}
          />
        )}
      </div>
    </main>
  );
}

function TabButton({
  active,
  onClick,
  label,
}: {
  active: boolean;
  onClick: () => void;
  label: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        'flex flex-1 items-center justify-center px-3 py-1.5 text-sm',
        active
          ? 'bg-toast text-foreground'
          : 'text-muted-foreground hover:text-foreground'
      )}
    >
      {label}
    </button>
  );
}
```

- [ ] **Step 2: Verify that `useAnonToken` + `useApiKey` import paths resolve**

Run:

```bash
npm --prefix packages/dashboard run typecheck
```

If `useAnonToken` path differs in this repo, adjust the import to match what `ConnectDialogV2.tsx` uses.

- [ ] **Step 3: Lint**

```bash
npm --prefix packages/dashboard run lint
```

Expected: clean. Leave changes in the working tree.

---

## Task 8: Create `DTestConnectedDashboard`

**Why:** The connected-state dashboard. Header + 4 metric cards. Mirrors C test Phase 2 minus the stepper.

**Files:**
- Create: `packages/dashboard/src/features/dashboard/components/dtest/DTestConnectedDashboard.tsx`

- [ ] **Step 1: Write the dashboard**

```tsx
// packages/dashboard/src/features/dashboard/components/dtest/DTestConnectedDashboard.tsx
import { useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { Badge } from '@insforge/ui';
import { Braces, Database, HardDrive, User } from 'lucide-react';
import { MetricCard } from '../MetricCard';
import { useMetadata } from '../../../../lib/hooks/useMetadata';
import { useCloudProjectInfo } from '../../../../lib/hooks/useCloudProjectInfo';
import { useUsers } from '../../../auth';
import { isInsForgeCloudProject } from '../../../../lib/utils/utils';

export function DTestConnectedDashboard() {
  const navigate = useNavigate();
  const isCloudProject = isInsForgeCloudProject();
  const {
    metadata,
    tables,
    storage,
    isLoading: isMetadataLoading,
    error: metadataError,
  } = useMetadata();
  const { projectInfo } = useCloudProjectInfo();
  const { totalUsers } = useUsers();

  const projectName = isCloudProject
    ? projectInfo.name || 'My InsForge Project'
    : 'My InsForge Project';
  const instanceType = projectInfo.instanceType?.toUpperCase();
  const showInstanceTypeBadge = isCloudProject && !!instanceType;

  const projectHealth = useMemo(() => {
    if (metadataError) return 'Issue';
    if (isMetadataLoading) return 'Loading...';
    return 'Healthy';
  }, [isMetadataLoading, metadataError]);

  const isHealthy = projectHealth === 'Healthy';

  const tableCount = tables?.length ?? 0;
  const databaseSize = (metadata?.database.totalSizeInGB ?? 0).toFixed(2);
  const storageSize = (storage?.totalSizeInGB ?? 0).toFixed(2);
  const bucketCount = storage?.buckets?.length ?? 0;
  const functionCount = metadata?.functions.length ?? 0;

  return (
    <main className="h-full min-h-0 min-w-0 overflow-y-auto bg-semantic-0">
      <div className="flex w-full flex-col gap-12 px-10 py-8">
        <div className="flex items-center gap-2">
          <h1 className="text-2xl font-normal leading-8 text-foreground">{projectName}</h1>
          {showInstanceTypeBadge && (
            <Badge
              variant="default"
              className="rounded bg-[var(--alpha-8)] px-1 py-0.5 text-xs font-medium uppercase text-muted-foreground"
            >
              {instanceType}
            </Badge>
          )}
          <div className="flex items-center rounded-full bg-toast px-2 py-1">
            <div
              className={`mr-1.5 h-2 w-2 rounded-full ${isHealthy ? 'bg-emerald-400' : 'bg-amber-400'}`}
            />
            <span className="text-xs font-medium text-foreground">{projectHealth}</span>
          </div>
        </div>

        <div className="grid grid-cols-2 gap-3 xl:grid-cols-4">
          <MetricCard
            label="User"
            value={String(totalUsers ?? 0)}
            icon={<User className="h-5 w-5" />}
            onNavigate={() => void navigate('/dashboard/authentication/users')}
          />
          <MetricCard
            label="Database"
            value={`${tableCount}`}
            subValueLeft={tableCount === 1 ? 'Table' : 'Tables'}
            subValueRight={`${databaseSize} GB`}
            icon={<Database className="h-5 w-5" />}
            onNavigate={() => void navigate('/dashboard/database/tables')}
          />
          <MetricCard
            label="Storage"
            value={`${bucketCount}`}
            subValueLeft={bucketCount === 1 ? 'Bucket' : 'Buckets'}
            subValueRight={`${storageSize} GB`}
            icon={<HardDrive className="h-5 w-5" />}
            onNavigate={() => void navigate('/dashboard/storage')}
          />
          <MetricCard
            label="Edge Functions"
            value={String(functionCount)}
            subValueLeft={functionCount === 1 ? 'Function' : 'Functions'}
            icon={<Braces className="h-5 w-5" />}
            onNavigate={() => void navigate('/dashboard/functions/list')}
          />
        </div>
      </div>
    </main>
  );
}
```

- [ ] **Step 2: Typecheck & lint**

```bash
npm --prefix packages/dashboard run typecheck
npm --prefix packages/dashboard run lint
```

Expected: clean. Leave changes in the working tree.

---

## Task 9: Create `DTestDashboardPage` entry

**Why:** Ties it all together. Picks between Install / Detail / Dashboard using `useDTestView`, and renders a loading skeleton while onboarding status is still being resolved.

**Files:**
- Create: `packages/dashboard/src/features/dashboard/pages/DTestDashboardPage.tsx`

- [ ] **Step 1: Write the entry**

```tsx
// packages/dashboard/src/features/dashboard/pages/DTestDashboardPage.tsx
import { Skeleton } from '../../../components';
import { useMcpUsage } from '../../logs/hooks/useMcpUsage';
import { useProjectId } from '../../../lib/hooks/useMetadata';
import { useDTestView } from '../components/dtest/useDTestView';
import { InstallInsForgePage } from '../components/dtest/InstallInsForgePage';
import { ClientDetailPage } from '../components/dtest/ClientDetailPage';
import { DTestConnectedDashboard } from '../components/dtest/DTestConnectedDashboard';

function DTestLoadingState() {
  return (
    <main className="h-full min-h-0 min-w-0 overflow-y-auto bg-semantic-1">
      <div className="mx-auto flex w-full max-w-[640px] flex-col gap-6 px-6 pt-16">
        <Skeleton className="h-10 w-48" />
        <Skeleton className="h-[140px] w-full rounded" />
        <Skeleton className="h-[260px] w-full rounded" />
        <Skeleton className="h-[120px] w-full rounded" />
      </div>
    </main>
  );
}

export default function DTestDashboardPage() {
  const { hasCompletedOnboarding, isLoading: isMcpUsageLoading } = useMcpUsage();
  const { projectId } = useProjectId();

  const { view, setView, selectedClient, setSelectedClient } = useDTestView({
    hasCompletedOnboarding,
    projectId,
  });

  if (isMcpUsageLoading) {
    return <DTestLoadingState />;
  }

  if (view === 'install') {
    if (selectedClient !== null) {
      return (
        <ClientDetailPage clientId={selectedClient} onBack={() => setSelectedClient(null)} />
      );
    }
    return (
      <InstallInsForgePage
        onSelectClient={(id) => setSelectedClient(id)}
        onDismiss={() => setView('dashboard', { dismiss: true })}
      />
    );
  }

  return <DTestConnectedDashboard />;
}
```

- [ ] **Step 2: Typecheck & lint**

```bash
npm --prefix packages/dashboard run typecheck
npm --prefix packages/dashboard run lint
```

Expected: clean. Leave changes in the working tree.

---

## Task 10: Register `d_test` in the router

**Why:** Wires the new page to the `dashboard-v3-experiment` flag.

**Files:**
- Modify: `packages/dashboard/src/router/AppRoutes.tsx`

- [ ] **Step 1: Import and extend the variant switch**

Add the import alongside the existing dashboard imports near the top of `AppRoutes.tsx`:

```tsx
import DTestDashboardPage from '../features/dashboard/pages/DTestDashboardPage';
```

Replace the `DashboardHomePage` assignment at `AppRoutes.tsx:51-52`:

```tsx
const dashboardVariant = getFeatureFlag('dashboard-v3-experiment');
const DashboardHomePage =
  dashboardVariant === 'c_test'
    ? CTestDashboardPage
    : dashboardVariant === 'd_test'
      ? DTestDashboardPage
      : DashboardPage;
```

- [ ] **Step 2: Typecheck & lint**

```bash
npm --prefix packages/dashboard run typecheck
npm --prefix packages/dashboard run lint
```

Expected: clean. Leave changes in the working tree.

---

## Task 11: Make top-nav `Connect` variant-aware

**Why:** On `d_test` + `/dashboard`, clicking Connect should set `?view=install` instead of opening the modal. Other variants unchanged.

**Files:**
- Modify: `packages/dashboard/src/layout/AppHeader.tsx`

- [ ] **Step 1: Replace the Connect button handler**

Add imports at the top of `AppHeader.tsx`:

```tsx
import { useLocation, useSearchParams } from 'react-router-dom';
import { getFeatureFlag } from '../lib/analytics/posthog';
```

Inside `AppHeader`, below existing hooks (`useOpenConnectDialog`), add:

```tsx
const location = useLocation();
const [searchParams, setSearchParams] = useSearchParams();
const dashboardVariant = getFeatureFlag('dashboard-v3-experiment');
const isDTestDashboard =
  dashboardVariant === 'd_test' && location.pathname === '/dashboard';

const handleConnectClick = () => {
  if (isDTestDashboard) {
    const next = new URLSearchParams(searchParams);
    next.set('view', 'install');
    setSearchParams(next, { replace: true });
    return;
  }
  openConnectDialog();
};
```

Replace the existing `onClick={openConnectDialog}` on the Connect `Button` with `onClick={handleConnectClick}`.

- [ ] **Step 2: Typecheck & lint**

```bash
npm --prefix packages/dashboard run typecheck
npm --prefix packages/dashboard run lint
```

Expected: clean. Leave changes in the working tree.

---

## Task 12: Manual verification

**Why:** No UI test infrastructure exists in `packages/dashboard`; this task documents the exact walkthrough that must pass before opening the PR.

- [ ] **Step 1: Start the dev server**

```bash
npm run dev
```

Log in with a dev account. Use the PostHog feature-flag override (add `?__posthog-ff-dashboard-v3-experiment=d_test` to the URL, or use the in-app PostHog debug panel) to force `d_test`.

- [ ] **Step 2: Walk the unconnected flow**

- Account must have zero successful MCP usage records.
- Visit `/dashboard`. Expect the Install InsForge page.
- "Setup In Claude Code" section shows Claude Code tile.
- "Install in Coding Agent" grid shows 7 tiles: Claude Code / Codex / Antigravity / Cursor / Copilot / Trae / Other Agents.
- "Direct Connect" section shows Connection String and API Keys tiles.
- Click each agent tile → detail page with the correct icon and label; CLI tab shows NewCLISection; MCP tab dropdown is preselected to the matching agent (or Cursor for Other Agents).
- Click Connection String tile → detail page shows `ConnectionStringSectionV2` content.
- Click API Keys tile → detail page shows `APIKeysSectionV2` content.
- In each detail page, click `← All Clients` → returns to Install page.
- Refresh the browser while on the detail page → returns to Install main view (expected: detail selection is session-local).

- [ ] **Step 3: Walk the dismissal + toggle flow**

- From the Install page, click the top-right `[X]` → lands on the Connected Dashboard (empty counts if no data).
- Refresh → still on the Connected Dashboard (dismissal flag persisted).
- Click the top-nav `Connect` button → returns to Install page. URL shows `?view=install`.
- Refresh on `/dashboard?view=install` → still on Install page.
- Remove the `view` query param manually → Connected Dashboard (because dismissal flag is set).

- [ ] **Step 4: Walk the connected flow**

- Ensure the account has at least one successful MCP usage record (use an MCP-enabled agent to call `list_tables` once).
- Open a fresh incognito tab and set the feature flag to `d_test`.
- Clear localStorage for this origin so the dismissal flag is reset.
- Visit `/dashboard`. Expect the Connected Dashboard directly (header + 4 metric cards, no Prompt Stepper).
- Click Connect in the top nav → returns to Install page.

- [ ] **Step 5: Regression check other variants**

- Override PostHog flag to `c_test`. Visit `/dashboard`. Expect C test Phase 1 (centered Get Started) if unconnected, or Phase 2 (stepper + metrics) if connected. Metric cards should render correctly via the shared `MetricCard`.
- Override PostHog flag to absent/`control`. Visit `/dashboard`. Expect the original `DashboardPage`.
- On both variants, clicking the top-nav `Connect` button opens the original `ConnectDialog` modal (not the new Install page).

- [ ] **Step 6: Hand off to user**

All code changes remain **uncommitted** in the working tree. Per the commit policy at the top of this plan, the user will commit manually once they have reviewed everything.

When the user asks to commit / open a PR, use:

- Title: `feat(dtest): add D test onboarding variant`
- Body must include:
  - Link to the design spec: `docs/superpowers/specs/2026-04-21-dtest-onboarding-design.md`
  - Note: **Before rollout**, add a `d_test` variant to the `dashboard-v3-experiment` flag in PostHog. Until the variant exists, no user traffic is affected.
  - Summary of the verification walkthrough above.
  - Screenshots / screen recordings of: unconnected Install page, a detail page (CLI + MCP tabs), connected dashboard.

---

## Self-Review Checklist

- **Spec coverage:** every spec section maps to at least one task.
  - Connected-state detection → used in Task 9 (`hasCompletedOnboarding` from `useMcpUsage`) and Task 4 (`useDTestView`).
  - View model + URL sync + dismissal → Task 4.
  - Install page layout (3 sections) → Task 6.
  - Client detail layout (CLI/MCP toggle, direct connect kinds) → Task 7.
  - Connected dashboard (header + 4 metric cards) → Task 8.
  - MCP preselection prop → Task 2.
  - MetricCard extraction → Task 1.
  - Router wiring → Task 10.
  - Top-nav Connect behavior → Task 11.
  - Manual verification + PostHog flag note → Task 12.
- **Placeholders:** none.
- **Type consistency:** `ClientId`, `ClientEntry`, and `DTestView` are defined once (Tasks 3 & 4) and reused verbatim in later tasks.
