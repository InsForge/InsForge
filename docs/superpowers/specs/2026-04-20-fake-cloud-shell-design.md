# Fake Cloud Shell for Local Development

## Overview

Add a developer-only "fake cloud shell" that lets contributors of the open-source InsForge repo see and develop cloud-hosting-only UI without access to the private `insforge-cloud` / `insforge-cloud-backend` repos.

Enabled via a single build-time env var `VITE_MOCK_CLOUD=true`. Introduces a third top-level app mode (alongside the existing `SelfHostingDashboard` and `CloudHostingDashboard`) that wraps `<InsForgeDashboard mode="cloud-hosting" ...>` with a minimal replica of the cloud navbar and hardcoded stub props, so cloud-only code paths (Deployments, Backup, Instance info, Connect dialog CLI tab, etc.) render locally.

## Motivation

The cloud frontend and the cloud backend live in two private repos. OSS contributors running self-hosting dashboards locally only ever see the self-hosting UI, which means they cannot view or iterate on cloud-only UI paths that exist in the OSS `packages/dashboard` codebase but are gated behind `useIsCloudHostingMode()` / `isInsForgeCloudProject()` / `host.mode === 'cloud-hosting'`.

PR #1126 shipped a manual "hardcode these three variables, then revert" skill as a workaround. The workflow is error-prone — contributors have to remember to revert, and regressions slip through. This proposal replaces it with a committed code path guarded by an env var.

Matches the intent Fermionic proposed in PR #1126: "implement a local cloud-mocking shell, which replace the local navbar with the cloud one, and enable all cloud features (but just for UI). Control it with a single variable, command or flag."

## Existing Structure (as discovered)

`frontend/src/App.tsx` is the top-level router between hosting modes:

```
frontend/src/App.tsx
  if isCloudHosting()          → <CloudHostingDashboard />   // runs inside real cloud iframe
  else                         → <SelfHostingDashboard />    // default local dev
```

Both components are thin wrappers around `<InsForgeDashboard>` exported from `packages/dashboard`. `CloudHostingDashboard` uses a `useCloudHosting()` hook that handles all postMessage communication with the real cloud parent window and produces the `project`, `getAuthorizationCode`, `onRenameBackup`, etc. props. `SelfHostingDashboard` passes `mode="self-hosting"` and nothing else.

The dashboard library accepts these as props — it does not care whether a human, a real cloud iframe, or a stub is providing them. That property is what makes this design tractable: we do not need to modify `packages/dashboard` at all except for a small override in `isInsForgeCloudProject()`.

## Scope

**In scope**

- A new top-level component `FakeCloudDashboard` in `frontend/src/` that mirrors `CloudHostingDashboard` but with hardcoded fake project and stub callbacks instead of `useCloudHosting()`.
- A new `FakeCloudNavbar` visual component that renders above the dashboard — one top bar, visual parity with the cloud navbar within a tolerance.
- A branch in `frontend/src/App.tsx` that selects `FakeCloudDashboard` when `import.meta.env.VITE_MOCK_CLOUD === 'true'`.
- An override inside `isInsForgeCloudProject()` (in `packages/dashboard`) that returns `true` when the mock env var is set, bypassing the hostname-based check.
- A hardcoded fake project, organization, and stub callback set in `frontend/src/mock-cloud/fixtures.ts`.

**Out of scope (explicit YAGNI)**

- No iframe nesting. `FakeCloudNavbar` and `InsForgeDashboard` render in one React tree.
- No postMessage protocol stub. `useCloudHosting()` (which owns postMessage) is never called in mock mode, so postMessage code paths naturally do not execute. Cloud-only behavior that depends on messages from a cloud parent (auth code delivery, project rename broadcasts) does not run in mock mode.
- No Organizations / Members / Subscription / Billing / Usage / Profile page replicas. Those pages live only in the cloud repo; this shell does not recreate them.
- No org switcher / project switcher / user dropdown wired to real behavior. The fake navbar may include these elements as visual decoration; clicks are no-ops or show a "mock mode" toast.
- No fixture data for cloud-only list/detail pages. Deployments / Backup / Instance pages show empty state.
- No MSW or mock HTTP layer. Stubbing happens at the prop / gate function level, not the network level.

## Architecture

```
VITE_MOCK_CLOUD=true npm run dev
      │
      ▼
frontend/src/App.tsx
      │
      ├─ if import.meta.env.VITE_MOCK_CLOUD === 'true' → <FakeCloudDashboard />
      ├─ else if isCloudHosting()                      → <CloudHostingDashboard />
      └─ else                                          → <SelfHostingDashboard />

FakeCloudDashboard
      ├─ <FakeCloudNavbar />                           // new, visual only
      └─ <InsForgeDashboard                            // unchanged library component
            mode="cloud-hosting"
            project={FAKE_PROJECT}
            getAuthorizationCode={STUB_GET_AUTH_CODE}
            onRequestBackupInfo={() => null}
            ...all other callbacks as stubs
         />
```

Production builds without the flag tree-shake the entire `frontend/src/mock-cloud/` directory out via Vite's `import.meta.env` dead-code elimination.

## Components

### 1. `frontend/src/mock-cloud/FakeCloudDashboard.tsx` (new)

Mirrors `CloudHostingDashboard.tsx` in structure but skips `useCloudHosting()`:

```tsx
import { InsForgeDashboard } from '@insforge/dashboard';
import { FakeCloudNavbar } from './FakeCloudNavbar';
import { FAKE_PROJECT, STUB_CALLBACKS } from './fixtures';

export function FakeCloudDashboard() {
  return (
    <>
      <FakeCloudNavbar />
      <InsForgeDashboard
        mode="cloud-hosting"
        showNavbar={false}
        project={FAKE_PROJECT}
        getAuthorizationCode={STUB_CALLBACKS.getAuthorizationCode}
        useAuthorizationCodeRefresh={false}
        onRouteChange={STUB_CALLBACKS.onRouteChange}
        onNavigateToSubscription={STUB_CALLBACKS.onNavigateToSubscription}
        onRenameProject={STUB_CALLBACKS.onRenameProject}
        onDeleteProject={STUB_CALLBACKS.onDeleteProject}
        onRequestBackupInfo={STUB_CALLBACKS.onRequestBackupInfo}
        onCreateBackup={STUB_CALLBACKS.onCreateBackup}
        onDeleteBackup={STUB_CALLBACKS.onDeleteBackup}
        onRenameBackup={STUB_CALLBACKS.onRenameBackup}
        onRestoreBackup={STUB_CALLBACKS.onRestoreBackup}
        onRequestInstanceInfo={STUB_CALLBACKS.onRequestInstanceInfo}
        onRequestInstanceTypeChange={STUB_CALLBACKS.onRequestInstanceTypeChange}
        onUpdateVersion={STUB_CALLBACKS.onUpdateVersion}
        onRequestUserInfo={STUB_CALLBACKS.onRequestUserInfo}
      />
    </>
  );
}
```

`showNavbar={false}` prevents the dashboard from rendering its own top nav — the fake one takes that role.

### 2. `frontend/src/mock-cloud/FakeCloudNavbar.tsx` (new)

A visual replica of the cloud top navbar, built using `@insforge/ui` primitives so atomic visuals (buttons, dropdowns, icons) inherit from the shared component library:

- Left: InsForge logo + "MOCK" badge (so contributors never confuse this with real cloud) + org dropdown (decorative) + project dropdown (decorative, shows `FAKE_PROJECT.name`)
- Right: upgrade button, contact link, user avatar dropdown (decorative)

All interactive elements either no-op or open a toast reading "Mock cloud mode — action disabled".

### 3. `frontend/src/mock-cloud/fixtures.ts` (new)

```ts
export const FAKE_PROJECT: DashboardProjectInfo = {
  id: 'mock-project-id',
  name: 'Mock Cloud Project',
  // ...minimum fields consumers of DashboardHostContext read
};

export const FAKE_ORG = {
  id: 'mock-org-id',
  name: 'Mock Organization',
};

export const STUB_CALLBACKS = {
  getAuthorizationCode: async () => 'mock-auth-code',
  onRouteChange: () => {},
  onNavigateToSubscription: () => {},
  onRenameProject: async () => {},
  onDeleteProject: async () => {},
  onRequestBackupInfo: async () => null,
  onCreateBackup: async () => null,
  onDeleteBackup: async () => {},
  onRenameBackup: async () => {},
  onRestoreBackup: async () => {},
  onRequestInstanceInfo: async () => null,
  onRequestInstanceTypeChange: async () => {},
  onUpdateVersion: async () => {},
  onRequestUserInfo: async () => null,
};
```

The exact fields on `FAKE_PROJECT` are determined during implementation by reading what `DashboardProjectInfo` expects.

### 4. `frontend/src/App.tsx` (modify)

Add a branch before the existing two:

```tsx
if (import.meta.env.VITE_MOCK_CLOUD === 'true') {
  return <FakeCloudDashboard />;
}
if (isCloudHosting()) {
  return <CloudHostingDashboard />;
}
return <SelfHostingDashboard />;
```

### 5. `packages/dashboard/src/lib/utils.ts` (modify `isInsForgeCloudProject`)

`isInsForgeCloudProject()` reads `window.location.hostname` and matches `.insforge.app`. In local dev, hostname is `localhost`, so it returns `false` regardless of the `mode` prop. This is a distinct signal from `host.mode === 'cloud-hosting'` and has 25 call sites across 14 files.

Add a mock-mode short circuit at the top of the function:

```ts
export function isInsForgeCloudProject() {
  if (import.meta.env.VITE_MOCK_CLOUD === 'true') return true;
  // ...existing hostname check
}
```

This is the only change required inside `packages/dashboard`. Because `VITE_MOCK_CLOUD` is a Vite env var, and `packages/dashboard` is a library package, the consuming app's Vite config must make this env var reach the library's build. Verified during implementation; likely already the case since Vite exposes all `VITE_*` env vars to imported code. If not, the override instead reads a global flag set by `FakeCloudDashboard` on mount.

## Data Flow

1. Dev runs `VITE_MOCK_CLOUD=true npm run dev` from the root frontend app.
2. Vite injects `import.meta.env.VITE_MOCK_CLOUD = 'true'` at build time.
3. `App.tsx` sees the flag and renders `<FakeCloudDashboard />`.
4. `FakeCloudDashboard` renders `<FakeCloudNavbar />` + `<InsForgeDashboard mode="cloud-hosting" project={FAKE_PROJECT} ...stubs />`.
5. Inside the dashboard, `host.mode === 'cloud-hosting'` is true because the prop is set, so every direct mode check passes. `useIsCloudHostingMode()` derives from the same host context, so it returns true. `isInsForgeCloudProject()` returns true via the env-var override.
6. `AppSidebar.tsx` (existing, lines 23 & 29-42) sees `isCloud === true` and inserts the Deployments menu item automatically.
7. User navigates to any cloud-only page. The page's data hook fires a request to a cloud-only endpoint against the local self-hosting backend, which has no such route → 404 / empty. The page's existing empty-state renders.
8. Result: cloud navbar on top + self-hosting backend behind + cloud code paths firing + data pages in empty state.

## Known Gaps and Error Handling

- **Code paths behind postMessage are not exercised.** Any cloud-only behavior that requires a real cloud parent window (auth code exchange, project-rename broadcast from cloud to dashboard) does not fire — `useCloudHosting()` is not called. Contributors developing those specific features need real cloud access.
- **Empty-state pages show empty state.** Deployments / Backup / Instance list pages look sparse. If a contributor is iterating specifically on those pages' data-rendering UI, mock mode is insufficient and they need either real cloud or a future fixture layer (not built here).
- **No error toasts from failing cloud API calls.** The dashboard should show empty state, not errors, for expected-missing cloud endpoints. If existing hooks surface errors from `/deployments`, `/backups`, `/instance-info` 404s, those sites need per-call fallback or the hook must treat 404-in-mock as empty. This is an implementation-time verification — do a smoke test and fix per-site only where needed.
- **Security posture.** Mock code compiles into the bundle only when `VITE_MOCK_CLOUD=true` at build time. Production builds without the flag strip it entirely via Vite's dead-code elimination. A build-check script greps the production bundle for the string `mock-cloud` or `FakeCloudDashboard` and fails if found.

## Testing

- **Manual smoke test**: `VITE_MOCK_CLOUD=true npm run dev`, open `localhost:<port>`, verify fake navbar renders with "MOCK" badge, Deployments link appears in sidebar, clicking opens Deployments page in empty state, no console errors, no hanging requests, all other cloud-only pages (Backup settings, Instance info dialog, Connect dialog CLI tab) render without crashing.
- **Unit**: a test asserting `isInsForgeCloudProject()` returns `true` when the env var is set, false otherwise.
- **Build check**: a CI step (or npm script) asserting the mock shell code is not present in the production build output.
- **Visual regression**: deferred to v2.

## Maintenance Strategy

Visual fidelity requires `FakeCloudNavbar` to track changes in the real cloud navbar. Three mechanisms keep the cost bounded:

1. **Shared UI library.** Fake navbar built on `@insforge/ui` primitives. When cloud updates button / dropdown / icon visuals in that library, fake navbar inherits the change. Only layout and element selection drift.
2. **Accept lag.** The fake navbar is best-effort, not a spec-compliant clone. Allow it to fall behind cloud by weeks. On major cloud nav redesigns, the cloud team opens an issue against this repo to update the fake shell. Expected cadence: ~half a day per quarter.
3. **No protocol obligations (v1).** Because this design does not implement postMessage, the fake shell does not hold a contract with the cloud frontend. If a future version adds iframe + postMessage, extract a shared protocol types package at that time.

## Implementation Estimate

2–3 days:

- Day 1: `FakeCloudDashboard` + fixtures + `isInsForgeCloudProject` override + `App.tsx` branch. Dashboard renders in cloud mode with no fake navbar yet (bare but functional). Smoke-test every cloud-only route.
- Day 2: `FakeCloudNavbar` visual build against cloud navbar reference, wire into `FakeCloudDashboard`.
- Day 3: Fix any per-site empty-state / 404-error issues found in day 1 smoke test, build check script, unit test, retire or update the PR #1126 skill to point at the new env var.

## Open Questions

None blocking. Items to resolve during implementation:

- Exact field shape of `DashboardProjectInfo` (read from `packages/dashboard/src/types/index.ts` during implementation to complete `FAKE_PROJECT`).
- Whether any cloud-only data hook throws an error (as opposed to returning empty) when its endpoint 404s. Determined by smoke test.
- Whether `VITE_MOCK_CLOUD` env var is visible inside `packages/dashboard` code at build time, or whether the override has to read a runtime global set by `FakeCloudDashboard` instead.
