---
name: dashboard
description: Use this skill when contributing to InsForge's shared dashboard package. This is for maintainers editing `packages/dashboard`, which ships in `self-hosting` and `cloud-hosting` modes, and the local `frontend/` shell used for `self-hosting` in this repo.
---

# InsForge Dev Dashboard

Use this skill for dashboard work in the InsForge repository.

## Scope

- `packages/dashboard/src/**`
- `packages/dashboard/package.json`
- `packages/dashboard/README.md`
- `packages/dashboard/*.config.*`
- `frontend/src/**`
- `frontend/package.json`

## Working Rules

1. Respect the shared-package versus host-app boundary.
   - This dashboard is built with React and TypeScript.
   - `packages/dashboard/` is the source of truth for the dashboard product.
   - The package must support both `self-hosting` and `cloud-hosting` modes.
   - Keep self-hosting-only bootstrap, local env defaults, and shell styling in `frontend/`.
   - Do not let `packages/dashboard/` depend on `frontend/`.
   - If both modes need a capability, define it in the package API first.

2. Preserve dashboard data-flow conventions.
   - Follow the flow `service -> hook -> UI`.
   - Use `apiClient` for HTTP calls so auth refresh and error handling stay consistent.
   - Put request logic in services, data fetching and mutation state in hooks, and rendering/orchestration in UI components and pages.
   - Reuse existing contexts, host abstractions, and hooks before creating new global state.

3. Reuse the existing component layers.
   - Use `@insforge/ui` for generic primitives.
   - Use shared dashboard components when the pattern is already present.
   - Keep reusable dashboard UI in `packages/dashboard/`.
   - Only add UI to `frontend/` when it is specific to the local self-hosting shell.
   - Keep package styles scoped to the dashboard container.

4. Keep the package surface aligned with shared contracts.
   - Import cross-package types and Zod-derived shapes from `@insforge/shared-schemas`.
   - When backend payloads change, update the related services, hooks, UI, and exported types together.
   - Keep `packages/dashboard/src/index.ts` and `packages/dashboard/src/types` aligned with the public package API.
   - Never use the TypeScript `any` type. Prefer precise prop, state, API, and hook result types.

## Frontend Testing

Use the lowest test layer that covers the risk. Add one focused regression test for bug fixes when practical.

| Change type | Test layer | Location | Command |
| --- | --- | --- | --- |
| Pure helper, parser, formatter, state reducer | Unit | `packages/dashboard/src/**/__tests__/*.test.ts` | `npm --workspace @insforge/dashboard run test:unit` |
| React component behavior, forms, dialogs, conditional rendering | Component | `packages/dashboard/src/**/__tests__/*.test.tsx` | `npm --workspace @insforge/dashboard run test:component` |
| Routing, auth redirects, host-mode integration, browser-only behavior | UI smoke | `packages/dashboard/tests/ui/*.spec.ts` | `npm --workspace @insforge/dashboard run test:ui` |

Conventions:

- `npm --workspace @insforge/dashboard run test` runs the full Vitest suite: unit plus component.
- GitHub Actions splits dashboard checks into unit, component, and UI jobs in `.github/workflows/frontend-tests.yml`. Update the workflow when adding or renaming test scripts.
- Unit tests should avoid React rendering and network mocking. Test data transformations directly.
- Component tests use Testing Library with `packages/dashboard/src/test/setup.ts`. Mock hooks, services, and host context at the package boundary; assert user-visible behavior and callback effects, not implementation details or CSS class strings.
- UI smoke tests use Playwright against the local `frontend/` shell. Mock backend API routes in `packages/dashboard/tests/ui/fixtures/`; every mocked route must either fulfill, fallback, or abort. Do not leave requests pending after a test branch.
- Prefer one clear test per user-observable behavior over broad snapshot tests. Avoid brittle assertions tied to copy that is not part of the behavior being protected.

## Local debug: viewing cloud-hosting-only UI in self-hosting

**Use when** previewing UI gated on `useIsCloudHostingMode()`, `isInsForgeCloudProject()`, or a PostHog feature flag (e.g. the CTest dashboard variant, `dashboard-v3-experiment === 'c_test'`, the CLI connect panel) while running the local `frontend/` self-hosting shell.

The lowest-friction approach is to **temporarily hardcode** the three gates below to `true`/the new branch, then restart the Vite dev server. These edits bypass real host/project detection and MUST be fully reverted before committing — landing them breaks both self-hosting and cloud-hosting users.

### Hardcodes

1. `packages/dashboard/src/lib/config/DashboardHostContext.tsx` — `useIsCloudHostingMode()` → `return true;` (was `useDashboardHost().mode === 'cloud-hosting'`).
2. `packages/dashboard/src/lib/utils/utils.ts` — `isInsForgeCloudProject()` → `return true;` (was the `.insforge.app` hostname check).
3. If the UI is also feature-flag-gated, hardcode the consumer. For CTest: `AppRoutes.tsx` → `const DashboardHomePage = CTestDashboardPage;` and, if relevant, the matching branch in `AppLayout.tsx` for `<ConnectDialogV2>`.

Mark every hardcode with a trailing `// LOCAL DEBUG: <original expression>` comment so revert is a mechanical search.

### Revert checklist — run all before committing

1. `git grep -n "LOCAL DEBUG" packages/dashboard/src/` returns zero matches.
2. Each gate is restored to its **original expression**, not just an equivalent value (the `mode === 'cloud-hosting'` comparison, the hostname check, the `getFeatureFlag(...)` call must all be back).
3. Any imports deleted during debug (commonly `DashboardPage`, `getFeatureFlag`, `ConnectDialog`) are restored.
4. `cd packages/dashboard && npm run lint && npm run typecheck` both pass.
5. `git diff` of the four files above shows only intended changes — no `return true;`, no missing imports.

### Rationalizations to reject

| Excuse | Reality |
|--------|---------|
| "I'll revert in a follow-up PR." | Follow-up = a window where prod is broken. Revert now. |
| "The original check was effectively the same." | If it were, you wouldn't have needed the hardcode. Restore the expression, not a value-equivalent. |
| "Lint passed, so the deleted import doesn't matter." | Lint passed because the import was deleted; on revert the original code needs it back. |
| "I'll ship the env-var override instead." | No env-var override is wired in the code. Don't invent one on the commit path — restore the original. |

## Locale / language preference

The dashboard has a language preference layer (selector + cloud sync) and
bundled react-i18next translations for the chrome, overview page, and Backend
Advisor (`lib/i18n/`, namespace `chrome`). Feature pages beyond those are
still English — extend the same namespace as they get translated.

- `lib/contexts/LocaleContext.tsx` — `LocaleProvider` / `useLocale` /
  `SUPPORTED_LOCALES` / `normalizeLocale`. Resolution order: cloud account
  preference → `insforge-locale` localStorage → `navigator.language` → `en`.
  Mirrors the ThemeContext pattern.
- `components/LanguageSelect.tsx` — endonym-labelled selector; rendered in
  `AppHeader` (self-host) and the `AppSidebar` bottom in cloud-hosting mode
  (the header is hidden inside the iframe).
- Cloud sync contract (`@insforge/shared-schemas` cloud-events):
  parent → child `USER_INFO` carries optional `preferredLocale`;
  child → parent `UPDATE_PREFERRED_LOCALE { locale }` is fire-and-forget and
  the shell persists it to `users.preferred_locale` via the profile API
  (plumbed through the `onUpdatePreferredLocale` host prop).
- **Version-skew tolerance is a contract**: old shells ignore unknown message
  types; old dashboards ignore extra `USER_INFO` fields. Never make either
  side require the locale fields.
- Adding a language: extend `SUPPORTED_LOCALES` + `LOCALE_LABELS`, and keep
  the list aligned with the cloud marketing site's `src/i18n/routing.ts`
  (insforge-cloud repo) or the account preference will name a locale one
  surface can't render. Route locale-ish input through `normalizeLocale`.
- Self-host mode must work with zero cloud callbacks (localStorage only);
  extend `lib/contexts/__tests__/LocaleContext.test.tsx` when touching this.
- Every key added to `lib/i18n/locales/en.json` must exist in all four locale
  files — `lib/i18n/__tests__/localeParity.test.ts` fails CI otherwise
  (plural suffixes normalized; zh carries only `_other`).
- Never translate user-generated names (tables, buckets) — only static ids.
  See the note in `components/FeatureSidebar.tsx`.

## Validation

- `cd packages/dashboard && npm run test:unit` when changing pure helpers or reducers
- `cd packages/dashboard && npm run test:component` when changing React component behavior
- `cd packages/dashboard && npm run test:ui` when changing routing, auth, host-mode integration, or browser-only behavior
- `cd packages/dashboard && npm run typecheck`
- `cd packages/dashboard && npm run build`
- `cd frontend && npm run build` when the local self-hosting shell changes

For shared contract changes, also validate `packages/shared-schemas/` and the affected backend surface.
