# Fake Cloud Shell Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a dev-only `VITE_MOCK_CLOUD=true` mode that runs the OSS dashboard with a fake cloud navbar on top, a hardcoded fake project, and all cloud-mode gates forced true — so OSS contributors can see and develop cloud-only UI without access to the private `insforge-cloud` repo.

**Architecture:** A new `FakeCloudDashboard` wrapper lives at `frontend/src/mock-cloud/` and selects itself via an env-var branch in `frontend/src/App.tsx` (before the existing self-hosting / real-cloud selection). It passes `mode="cloud-hosting"` + hardcoded stub props into the unchanged `<InsForgeDashboard>` library, and sets a runtime `window.__INSFORGE_MOCK_CLOUD__` flag that `isInsForgeCloudProject()` reads to short-circuit its hostname check. No iframe, no postMessage stubs, no fixture data — cloud-only data pages render empty state.

**Tech Stack:** React 19, Vite 7, TypeScript 5, `@insforge/ui` primitives, react-router-dom 7.

**Spec:** `docs/superpowers/specs/2026-04-20-fake-cloud-shell-design.md`

---

## File Structure

### New files
- `frontend/src/mock-cloud/fixtures.ts` — `FAKE_PROJECT`, `STUB_CALLBACKS`, `MOCK_CLOUD_FLAG` constant name
- `frontend/src/mock-cloud/FakeCloudNavbar.tsx` — visual replica of cloud top navbar
- `frontend/src/mock-cloud/FakeCloudDashboard.tsx` — wrapper around `<InsForgeDashboard>` with stubs + navbar

### Modified files
- `frontend/src/App.tsx` — add branch selecting `FakeCloudDashboard` when `import.meta.env.VITE_MOCK_CLOUD === 'true'`
- `packages/dashboard/src/lib/utils/utils.ts` — add runtime-flag short-circuit to `isInsForgeCloudProject()`
- `.agents/skills/insforge-dev/dashboard/SKILL.md`, `.claude/skills/insforge-dev/dashboard/SKILL.md`, `.codex/skills/insforge-dev/dashboard/SKILL.md` — retire the manual hardcode workflow from PR #1126, replace with `VITE_MOCK_CLOUD=true` instruction

### Why these boundaries
All new code lives in `frontend/src/mock-cloud/` so it is one directory, easy to locate, easy to tree-shake verify. The dashboard package gets exactly one 2-line change (the short-circuit) — keeps the library untouched logically. Skill docs follow the existing triplet convention.

---

## Task 1: Fixtures

**Files:**
- Create: `frontend/src/mock-cloud/fixtures.ts`

- [ ] **Step 1: Write the file**

```ts
import type {
  DashboardProjectInfo,
  InsForgeDashboardProps,
} from '@insforge/dashboard';

// Runtime flag that packages/dashboard reads to short-circuit cloud detection
// in code paths that cannot see the frontend's Vite env var at build time.
export const MOCK_CLOUD_FLAG = '__INSFORGE_MOCK_CLOUD__';

export const FAKE_PROJECT: DashboardProjectInfo = {
  id: 'mock-project-id',
  name: 'Mock Cloud Project',
  region: 'us-east-1',
  instanceType: 'standard-1',
  latestVersion: 'v2.0.7',
  currentVersion: 'v2.0.7',
  status: 'active',
};

type CloudProps = Extract<InsForgeDashboardProps, { mode: 'cloud-hosting' }>;

export const STUB_CALLBACKS: Omit<CloudProps, 'mode' | 'project'> = {
  backendUrl: undefined,
  showNavbar: false,
  useAuthorizationCodeRefresh: false,
  getAuthorizationCode: async () => 'mock-auth-code',
  onRouteChange: () => {},
  onNavigateToSubscription: () => {
    console.info('[MOCK] onNavigateToSubscription called');
  },
  onRenameProject: async () => {},
  onDeleteProject: async () => {},
  onRequestBackupInfo: async () => ({
    manualBackups: [],
    scheduledBackups: [],
  }),
  onCreateBackup: async () => {},
  onDeleteBackup: async () => {},
  onRenameBackup: async () => {},
  onRestoreBackup: async () => {},
  onRequestInstanceInfo: async () => ({
    currentInstanceType: 'standard-1',
    planName: 'Mock Plan',
    computeCredits: 0,
    currentOrgComputeCost: 0,
    instanceTypes: [],
    projects: [],
  }),
  onRequestInstanceTypeChange: async () => ({ success: false, error: 'mock mode' }),
  onUpdateVersion: async () => {},
  onRequestUserInfo: async () => ({
    userId: 'mock-user-id',
    email: 'mock@insforge.dev',
    name: 'Mock User',
  }),
};
```

- [ ] **Step 2: Verify typecheck**

Run: `npm run typecheck --workspace=frontend`
Expected: passes with no errors referencing `fixtures.ts`. If `InsForgeDashboardProps` is not exported from `@insforge/dashboard`, check `packages/dashboard/src/index.ts` — it should already be there; if not, export it and re-run.

- [ ] **Step 3: Commit**

```bash
git add frontend/src/mock-cloud/fixtures.ts
git commit -m "feat(mock-cloud): add fake project and stub callback fixtures"
```

---

## Task 2: Short-circuit `isInsForgeCloudProject()` with a runtime flag

**Files:**
- Modify: `packages/dashboard/src/lib/utils/utils.ts:163-169`

**Rationale:** `isInsForgeCloudProject()` reads `getDashboardBackendUrl()`'s hostname. In local dev, that hostname is `localhost`, so the function returns `false` even when `mode="cloud-hosting"` is passed in. 25 call sites across 14 files depend on this function returning `true` to render cloud UI. We short-circuit on a runtime `window` flag so the check works regardless of how the dashboard package is consumed (source via Vite alias, or published npm bundle).

- [ ] **Step 1: Modify `isInsForgeCloudProject()`**

Replace lines 163-169 with:

```ts
export const isInsForgeCloudProject = () => {
  if (
    typeof window !== 'undefined' &&
    (window as unknown as Record<string, unknown>).__INSFORGE_MOCK_CLOUD__ === true
  ) {
    return true;
  }
  try {
    return new URL(getDashboardBackendUrl()).hostname.endsWith('.insforge.app');
  } catch {
    return false;
  }
};
```

- [ ] **Step 2: Verify typecheck**

Run: `npm run typecheck --workspace=@insforge/dashboard`
Expected: passes.

- [ ] **Step 3: Commit**

```bash
git add packages/dashboard/src/lib/utils/utils.ts
git commit -m "feat(dashboard): short-circuit isInsForgeCloudProject on mock flag"
```

---

## Task 3: `FakeCloudNavbar`

**Files:**
- Create: `frontend/src/mock-cloud/FakeCloudNavbar.tsx`

**Rationale:** One top bar, visual parity with the cloud navbar (InsForge logo, org + project dropdowns, upgrade + contact + user avatar on the right), with a prominent "MOCK" badge so no contributor mistakes it for real cloud. All interactive elements are decorative no-ops or toasts.

- [ ] **Step 1: Write the component**

```tsx
import { Button } from '@insforge/ui';
import { FAKE_PROJECT } from './fixtures';

export function FakeCloudNavbar() {
  const notifyMock = () => {
    console.info('[MOCK] navbar action disabled in mock cloud mode');
  };

  return (
    <header
      className="flex items-center justify-between gap-4 border-b border-semantic-border bg-semantic-0 px-4 py-2"
      data-testid="fake-cloud-navbar"
    >
      <div className="flex items-center gap-3">
        <span className="text-sm font-semibold">InsForge</span>
        <span
          className="rounded bg-amber-500/20 px-2 py-0.5 text-xs font-semibold text-amber-600"
          aria-label="Mock cloud mode indicator"
        >
          MOCK
        </span>
        <Button variant="ghost" size="sm" onClick={notifyMock}>
          Mock Organization ▾
        </Button>
        <span className="text-xs text-semantic-muted">/</span>
        <Button variant="ghost" size="sm" onClick={notifyMock}>
          {FAKE_PROJECT.name} ▾
        </Button>
      </div>
      <div className="flex items-center gap-2">
        <Button variant="ghost" size="sm" onClick={notifyMock}>
          Upgrade
        </Button>
        <Button variant="ghost" size="sm" onClick={notifyMock}>
          Contact
        </Button>
        <Button variant="ghost" size="sm" onClick={notifyMock}>
          Mock User ▾
        </Button>
      </div>
    </header>
  );
}
```

**Note:** Check `packages/ui/src` for the actual `Button` export signature. If `Button` props differ (e.g. `variant` values, `size` enum), adjust. The visual is deliberately not pixel-perfect — see the spec's Maintenance Strategy for why.

- [ ] **Step 2: Verify typecheck**

Run: `npm run typecheck --workspace=frontend`
Expected: passes. If `Button` variant/size values are wrong, fix with values that exist in `packages/ui/src/Button` (or equivalent).

- [ ] **Step 3: Commit**

```bash
git add frontend/src/mock-cloud/FakeCloudNavbar.tsx
git commit -m "feat(mock-cloud): add FakeCloudNavbar visual shell"
```

---

## Task 4: `FakeCloudDashboard` wrapper

**Files:**
- Create: `frontend/src/mock-cloud/FakeCloudDashboard.tsx`

**Rationale:** Mirrors `frontend/src/cloud-hosting/CloudHostingDashboard.tsx` structurally, but skips `useCloudHosting()` (which owns postMessage + real cloud API calls) and passes hardcoded fakes instead. Sets the runtime `window.__INSFORGE_MOCK_CLOUD__` flag before the dashboard mounts so `isInsForgeCloudProject()` returns `true` everywhere.

- [ ] **Step 1: Write the component**

```tsx
import { useEffect, useState } from 'react';
import { InsForgeDashboard } from '@insforge/dashboard';
import { FakeCloudNavbar } from './FakeCloudNavbar';
import { FAKE_PROJECT, STUB_CALLBACKS, MOCK_CLOUD_FLAG } from './fixtures';

export function FakeCloudDashboard() {
  const [ready, setReady] = useState(false);

  useEffect(() => {
    (window as unknown as Record<string, unknown>)[MOCK_CLOUD_FLAG] = true;
    setReady(true);
    return () => {
      delete (window as unknown as Record<string, unknown>)[MOCK_CLOUD_FLAG];
    };
  }, []);

  if (!ready) {
    return null;
  }

  return (
    <div className="flex h-screen flex-col">
      <FakeCloudNavbar />
      <div className="min-h-0 flex-1">
        <InsForgeDashboard
          mode="cloud-hosting"
          project={FAKE_PROJECT}
          {...STUB_CALLBACKS}
        />
      </div>
    </div>
  );
}
```

**Why the `ready` gate:** `isInsForgeCloudProject()` is called synchronously during the first render of many dashboard components. Setting the flag inside `useEffect` runs *after* the first render, which would be too late. The two-pass render (`setReady(true)` triggers re-render after flag is set) guarantees every dashboard render sees the flag.

- [ ] **Step 2: Verify typecheck**

Run: `npm run typecheck --workspace=frontend`
Expected: passes.

- [ ] **Step 3: Commit**

```bash
git add frontend/src/mock-cloud/FakeCloudDashboard.tsx
git commit -m "feat(mock-cloud): add FakeCloudDashboard wrapper"
```

---

## Task 5: Branch in `App.tsx`

**Files:**
- Modify: `frontend/src/App.tsx`

- [ ] **Step 1: Modify the file**

Replace full contents with:

```tsx
import { CloudHostingDashboard } from './cloud-hosting/CloudHostingDashboard';
import { isCloudHosting } from './helpers';
import { SelfHostingDashboard } from './self-hosting/SelfHostingDashboard';
import { FakeCloudDashboard } from './mock-cloud/FakeCloudDashboard';

function App() {
  if (import.meta.env.VITE_MOCK_CLOUD === 'true') {
    return <FakeCloudDashboard />;
  }

  if (isCloudHosting()) {
    return <CloudHostingDashboard />;
  }

  return <SelfHostingDashboard />;
}

export default App;
```

- [ ] **Step 2: Verify typecheck**

Run: `npm run typecheck --workspace=frontend`
Expected: passes.

- [ ] **Step 3: Add Vite env type**

If `frontend/src/vite-env.d.ts` exists, add `VITE_MOCK_CLOUD` to its `ImportMetaEnv` interface. Otherwise create it:

```ts
/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_MOCK_CLOUD?: string;
  readonly VITE_API_BASE_URL?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
```

(If the file exists and already has an `ImportMetaEnv`, only add the `VITE_MOCK_CLOUD` line.)

- [ ] **Step 4: Commit**

```bash
git add frontend/src/App.tsx frontend/src/vite-env.d.ts
git commit -m "feat(mock-cloud): wire FakeCloudDashboard into App.tsx via VITE_MOCK_CLOUD"
```

---

## Task 6: Smoke test the full flow

**Files:** none

- [ ] **Step 1: Start the dev server in mock mode**

```bash
VITE_MOCK_CLOUD=true npm run dev --workspace=frontend
```

Expected: server starts on port 7131, no console errors in terminal.

- [ ] **Step 2: Open the app in a browser and verify each of the following**

Open `http://localhost:7131` and check:

1. **Navbar appears:** Fake cloud navbar at top with "MOCK" amber badge, "Mock Organization", "Mock Cloud Project", "Upgrade", "Contact", "Mock User" items.

2. **Sidebar has Deployments:** Left sidebar shows the cloud-version menu, specifically the **Deployments** item (which is only inserted when `isCloud === true` — see `packages/dashboard/src/layout/AppSidebar.tsx:23,29-42`). If it does not appear, the flag is not reaching `isInsForgeCloudProject()` — debug.

3. **Deployments page opens:** Click **Deployments**. Expected: page renders in empty state ("no deployments yet" or skeleton) without throwing an uncaught error. If it throws, find the throwing call site, note which cloud-only hook/service crashed on the 404 from local backend, and add a per-site fallback in Task 7.

4. **Connect dialog CLI tab:** Trigger the Connect dialog (the button that opens it) and check whether ConnectDialogV2 renders with the CLI tab (cloud-only) visible — requires `dashboard-v3-experiment === 'c_test'` feature flag. If feature flag is not set, only that dialog path is not exercised; OK.

5. **Project settings shows cloud-only items:** Open project settings dialog. Verify cloud-only rows are present (version upgrade, instance type change, delete project).

6. **No hanging network requests:** Open DevTools → Network. Cloud-only endpoints (`/deployments`, `/backups`, `/instance-info`) should return quickly (404 from local backend is fine and expected); nothing should sit in `pending` for more than a couple seconds.

7. **Console clean of crashes:** DevTools → Console. "Mock cloud mode" info logs are fine. React error boundaries / unhandled rejections / "Cannot read property X of undefined" are NOT fine — note them for Task 7.

- [ ] **Step 3: Baseline compare — run in normal mode**

Stop the dev server. Run without the flag:

```bash
npm run dev --workspace=frontend
```

Open `http://localhost:7131`. Verify self-hosting dashboard looks identical to before (no fake navbar, no Deployments menu item, no "MOCK" badge anywhere). This confirms the mock code does not leak into the normal path.

- [ ] **Step 4: Record findings**

In a scratch note (not committed), list any crashes, missing empty states, or broken cloud-only pages found in Step 2. These drive Task 7.

---

## Task 7: Fix surfaced issues + retire manual-hardcode skill

**Files:**
- Modify: `.agents/skills/insforge-dev/dashboard/SKILL.md`
- Modify: `.claude/skills/insforge-dev/dashboard/SKILL.md`
- Modify: `.codex/skills/insforge-dev/dashboard/SKILL.md`
- Modify: per-site fixes for anything Task 6 Step 4 surfaced

- [ ] **Step 1: Fix each issue from Task 6 Step 4**

For each crash or missing empty-state found, inspect the failing call site. Typical fix pattern:

If a hook throws on 404, wrap it with a mock-mode fallback. Example for a hook that must tolerate the absence of cloud data:

```ts
import { isInsForgeCloudProject } from '../../lib/utils/utils';

// inside the hook
if (response.status === 404 && isInsForgeCloudProject() && /* mock window flag */) {
  return emptyFallback;
}
```

**Do not add per-site fixes speculatively.** Only fix what actually breaks in Task 6 Step 2. Commit each fix in its own commit with a message like `fix(mock-cloud): empty-state for X`.

- [ ] **Step 2: Update the skill docs**

Find the "Local debug: viewing cloud-hosting-only UI in self-hosting" section in each of the three SKILL.md files and replace with a pointer to the new flow. The existing content mandates manual hardcode edits to `useIsCloudHostingMode()`, `isInsForgeCloudProject()`, and `AppRoutes.tsx` / `AppLayout.tsx`, plus a revert checklist.

Replace that entire section with this:

````markdown
## Local debug: viewing cloud-hosting-only UI in self-hosting

Run the frontend dev server with `VITE_MOCK_CLOUD=true` to activate the fake cloud shell — no file edits, no revert checklist.

```bash
VITE_MOCK_CLOUD=true npm run dev --workspace=frontend
```

The app renders with a fake cloud navbar on top (with a "MOCK" badge), a hardcoded fake project, all `isCloud` gates true, and cloud-only data pages (Deployments / Backup / Instance) in empty state. Stop and restart the dev server without the flag to return to normal self-hosting.

See `docs/superpowers/specs/2026-04-20-fake-cloud-shell-design.md` for known gaps (notably: code paths that depend on postMessage from a real cloud parent do not execute in mock mode).
````

- [ ] **Step 3: Commit**

```bash
git add .agents/skills/insforge-dev/dashboard/SKILL.md \
        .claude/skills/insforge-dev/dashboard/SKILL.md \
        .codex/skills/insforge-dev/dashboard/SKILL.md
git commit -m "docs(skills): replace manual hardcode skill with VITE_MOCK_CLOUD"
```

---

## Task 8: Production build sanity check

**Files:**
- Create: `frontend/scripts/verify-no-mock-cloud.sh` (optional — can be an ad-hoc command)

- [ ] **Step 1: Build without the flag and grep the output**

```bash
npm run build --workspace=frontend
grep -r "FakeCloudDashboard\|__INSFORGE_MOCK_CLOUD__\|fake-cloud-navbar" dist/frontend || echo "OK: mock code not in prod bundle"
```

Expected: `grep` returns no matches (exit 1), and the `|| echo "OK..."` prints the OK message. If `grep` finds matches, Vite is not tree-shaking the mock code — investigate and fix before shipping.

**Note:** `__INSFORGE_MOCK_CLOUD__` will still appear in the bundle (it is part of `isInsForgeCloudProject()` inside `packages/dashboard`), but `FakeCloudDashboard` and `fake-cloud-navbar` must not. Adjust the grep accordingly:

```bash
grep -r "FakeCloudDashboard\|fake-cloud-navbar" dist/frontend || echo "OK: mock UI code not in prod bundle"
```

- [ ] **Step 2: Build with the flag and verify it is included**

```bash
VITE_MOCK_CLOUD=true npm run build --workspace=frontend
grep -r "fake-cloud-navbar" dist/frontend && echo "OK: mock UI present when flag is set"
```

Expected: `grep` finds matches, echo prints. This confirms conditional inclusion actually works.

- [ ] **Step 3: Commit (if a script file was created)**

If you created `frontend/scripts/verify-no-mock-cloud.sh`, commit it. Otherwise skip — the commands above are sufficient to run manually or add to CI later.

```bash
git add frontend/scripts/verify-no-mock-cloud.sh
git commit -m "chore(mock-cloud): add prod bundle sanity check script"
```

---

## Self-Review Results

Ran the post-write self-review checklist.

**Spec coverage:** Every in-scope item in the spec maps to a task:
- `FakeCloudDashboard` + fixtures → Task 1, 4
- `FakeCloudNavbar` → Task 3
- `App.tsx` branch → Task 5
- `isInsForgeCloudProject()` override → Task 2
- Empty-state verification + per-site fixes → Task 6, 7
- Skill doc retirement → Task 7
- Production tree-shake check → Task 8

**Placeholder scan:** No TBDs, no "add appropriate error handling". Every code step shows the actual code. Task 7's per-site fixes are described with an explicit pattern and gated on actual failures found in Task 6.

**Type consistency:** `MOCK_CLOUD_FLAG` declared in fixtures.ts and used in FakeCloudDashboard.tsx. `FAKE_PROJECT` shape matches `DashboardProjectInfo` from `packages/dashboard/src/types/index.ts`. `STUB_CALLBACKS` shape derived from `InsForgeDashboardProps['cloud-hosting']` variant — correct by construction.

**Known simplification from spec:** The spec listed an "Open Question" about whether `AppLayout.tsx:48-71`'s postMessage listener needs suppression. Re-read of the code shows it is a passive listener that never fires without a parent window posting messages — no suppression needed, no explicit task required.
