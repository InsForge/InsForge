# Dashboard Package RFC

## Goal

Create a single publishable package, `@insforge/dashboard`, that becomes the shared source of truth
for the InsForge project dashboard.

This package will be consumed by:

- the self-hosting dashboard app inside this repo
- the `insforge-cloud` repo, replacing the current iframe embedding model

The package should own the dashboard product surface itself:

- authentication
- database
- storage
- functions
- AI
- logs
- internal dashboard navigation

It should not own the full cloud website:

- marketing pages
- org management shells
- billing checkout flows
- project provisioning flows

## Non-Goals

- Keep two long-term dashboard implementations in sync
- Move cloud-only pages into the shared package
- Rewrite backend APIs as part of the first migration
- Break the current OSS build while we scaffold the new architecture

## Source of Truth

The canonical dashboard implementation lives in this repo.

Recommended structure:

- `packages/dashboard`
  The only publishable dashboard package
- `frontend`
  The self-hosting host app. During migration this remains the current frontend folder and stays a
  thin host around the shared dashboard package.

The `insforge-cloud` repo should consume `@insforge/dashboard` as a dependency and provide only the
host-specific adapters and wrappers it needs.

## Package Contract

Primary export:

```tsx
<InsForgeDashboard
  mode="self-hosting"
  backendUrl="https://example.insforge.app"
  initialPath="/dashboard"
  auth={{
    strategy: 'session',
  }}
/>
```

```tsx
<InsForgeDashboard
  mode="cloud-hosting"
  backendUrl="https://project.region.insforge.app"
  initialPath="/dashboard/database"
  auth={{
    strategy: 'authorization-code',
    getAuthorizationCode: async () => {
      return code;
    },
  }}
  project={{
    id: 'project-id',
    name: 'My Project',
    region: 'us-east',
    instanceType: 'nano',
    latestVersion: 'v1.2.3',
    currentVersion: 'v1.2.0',
    status: 'active',
  }}
  capabilities={{
    canManageProjectSettings: true,
    canDeleteProject: true,
    canRenameProject: true,
    canManageInstance: true,
    canManageVersion: true,
    canOpenUsagePage: true,
    canOpenSubscriptionPage: true,
  }}
  onOpenSettings={() => {
    // host-owned modal or panel
  }}
  onNavigateToUsage={() => {
    // host-owned navigation
  }}
  onNavigateToSubscription={() => {
    // host-owned navigation
  }}
  onRenameProject={async (name) => {
    // host-owned mutation
  }}
  onDeleteProject={async () => {
    // host-owned mutation
  }}
  onRequestInstanceInfo={async () => {
    return instanceInfo;
  }}
  onRequestInstanceTypeChange={async (instanceType) => {
    return { success: true, instanceType };
  }}
  onUpdateVersion={async () => {
    // host-owned restart/update flow
  }}
/>
```

## Proposed Public Types

```ts
export type DashboardMode = 'self-hosting' | 'cloud-hosting';

export interface DashboardProjectInfo {
  id: string;
  name: string;
  region: string;
  instanceType: string;
  latestVersion?: string | null;
  currentVersion?: string | null;
  status?: 'active' | 'paused' | 'restoring' | string;
}

export interface DashboardCapabilities {
  canManageProjectSettings?: boolean;
  canDeleteProject?: boolean;
  canRenameProject?: boolean;
  canManageInstance?: boolean;
  canManageVersion?: boolean;
  canOpenUsagePage?: boolean;
  canOpenSubscriptionPage?: boolean;
}

export type DashboardAuthConfig =
  | {
      strategy: 'session';
    }
  | {
      strategy: 'authorization-code';
      getAuthorizationCode: () => Promise<string>;
    };

export interface DashboardInstanceInfo {
  currentInstanceType: string;
  planName: string;
  computeCredits: number;
  currentOrgComputeCost: number;
  instanceTypes: Array<{
    id: string;
    name: string;
    cpu: string;
    ram: string;
    pricePerHour: number;
    pricePerMonth: number;
  }>;
  projects: Array<{
    name: string;
    instanceType: string;
    monthlyCost: number;
    isCurrent: boolean;
    status: string;
  }>;
}

export interface DashboardProps {
  mode: DashboardMode;
  backendUrl: string;
  initialPath?: string;
  auth: DashboardAuthConfig;
  project?: DashboardProjectInfo;
  capabilities?: DashboardCapabilities;
  onOpenSettings?: () => void;
  onNavigateToUsage?: () => void;
  onNavigateToSubscription?: () => void;
  onRenameProject?: (name: string) => Promise<void>;
  onDeleteProject?: () => Promise<void>;
  onRequestInstanceInfo?: () => Promise<DashboardInstanceInfo>;
  onRequestInstanceTypeChange?: (
    instanceType: string
  ) => Promise<{ success: boolean; instanceType?: string; error?: string }>;
  onUpdateVersion?: () => Promise<void>;
}
```

## Routing Model

The package uses host-appropriate routing:

- `BrowserRouter` for self-hosting so the local app URL stays in sync with dashboard navigation
- `MemoryRouter` for cloud-hosting so the embedded dashboard can manage its own internal state

Why:

- avoids collisions with the cloud host router
- keeps the dashboard portable across OSS and cloud
- allows the host to pass `initialPath`

Recommended internal routes:

- `/dashboard`
- `/dashboard/authentication`
- `/dashboard/database`
- `/dashboard/storage`
- `/dashboard/functions`
- `/dashboard/ai`
- `/dashboard/logs`

## Styling Rules

The shared package must not apply document-wide layout assumptions.

Shared package styles must avoid:

- `html` selectors
- `body` selectors
- document-wide overflow rules
- document-wide font resets

Package styles may:

- style a scoped dashboard root container
- ship a package CSS entrypoint, e.g. `@insforge/dashboard/styles.css`
- import `@insforge/ui/styles.css`

Host apps may still own:

- page background
- global fonts
- host app shell styles

## Package Folder Tree

```text
packages/dashboard/
  package.json
  tsconfig.json
  README.md
  src/
    index.ts
    styles/
      index.css
    types/
      index.ts
    app/
      InsForgeDashboard.tsx
      DashboardProviders.tsx
    router/
      routes.tsx
    lib/
      api/
      auth/
      config/
      navigation/
    features/
      auth/
      database/
      storage/
      functions/
      ai/
      logs/
      dashboard/
    components/
      layout/
      common/
```

## OSS Host Folder Tree

```text
frontend/
  package.json
  tsconfig.json
  ...
```

## Migration Plan

### Phase 1

Create the package and the OSS Next app scaffolding without wiring either into production.

### Phase 2

Move the current dashboard code from `frontend/src` into `packages/dashboard/src` with minimal
behavior change.

### Phase 3

Replace same-origin assumptions with runtime config:

- hardcoded `/api`
- hardcoded `/socket.io`
- `window.location.origin`
- iframe-only auth flow
- `postMessage` bridge

### Phase 4

Mount the shared package inside `frontend`.

Keep the current Vite app working until parity is reached.

### Phase 5

Integrate the shared package into `insforge-cloud` and replace the iframe page with direct package
rendering.

### Phase 6

Remove the legacy iframe bridge and deprecate the Vite frontend once the OSS Next app and cloud app
both reach parity.

## Acceptance Criteria

- A single dashboard codebase serves both OSS and cloud
- `insforge-cloud` no longer embeds an iframe
- Self-hosted InsForge still runs as one product
- Host-specific actions are injected through props/callbacks, not window messaging
- The package remains small enough to understand and publish as one unit
