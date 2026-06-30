# design-sync notes — @insforge/ui

Repo-specific gotchas for future syncs. Read before re-syncing.

## Architecture (read this first)

- `@insforge/ui` is a **Tailwind v4 preset** design system. `dist/styles.css` ships
  **only design tokens** (CSS custom properties). The visual styling comes from
  Tailwind utility classes in the components' `className` strings, compiled at the
  **consuming app's** build time (see `packages/dashboard/tailwind.config.js`).
- design-sync's bundle is just the compiled JS, so **without a compiled utility
  stylesheet every preview and every design renders unstyled.** We pre-compile one:
  - `.design-sync/gen-preview-css.mjs` (committed) + `.design-sync/preview-tailwind.config.cjs`
    (committed) scan `packages/ui/src` and compile the utilities against the package's
    preset, prepend the token defs (comments stripped — see below), and write
    `packages/ui/dist/ds-preview.css` (gitignored, regenerated).
  - `cfg.cssEntry = "dist/ds-preview.css"`. **cssEntry is bounded to the package dir**,
    which is why the file is generated INSIDE `packages/ui/dist`, not under `.design-sync`.
  - `cfg.buildCmd` runs the package build **and** `gen-preview-css.mjs`. Always run both
    before the converter on re-sync (the driver uses buildCmd).

## Components / curation

- The `.d.ts` exports 76 PascalCase symbols, but only **21 are real root components**
  (one `src/components/*.tsx` file each). The other 55 are compound sub-parts
  (`DialogContent`, `SelectItem`, `MenuDialogNav`, `Tab`, …) re-exported flat — NOT
  dot-notation compounds, so the converter's auto-grouping can't collapse them.
  They are excluded from cards via `cfg.componentSrcMap: {<Sub>: null}` but **remain
  fully importable in the bundle** (window.InsforgeUi has all 81 exports). Compose
  sub-parts inside their parent's preview; document the compound APIs in conventions.md.
- If a root component is added/removed, update `componentSrcMap` (exclude its new sub-parts).

## CSS generation

- The token file's doc-comment contains a literal `@import '@insforge/ui/styles.css';`
  example that trips validate's `[CSS_IMPORT_MISSING]`. `gen-preview-css.mjs` strips CSS
  block comments from the token text before embedding. Don't remove that.

## Fonts

- Brand font is **Inter**, served at runtime from Google Fonts by the host apps
  (`frontend/index.html` `<link>`). Not shipped with the package. `gen-preview-css.mjs`
  prepends the same Google Fonts `@import` so previews/designs render in real Inter →
  validate reports `[FONT_REMOTE]` (informational, expected, not a new warn).

## Preview authoring conventions (calibrated)

- Import everything (roots + sub-parts) from `'@insforge/ui'`; icons from `'lucide-react'`.
- Use inline-style wrappers for layout scaffolding (padding/flex/gap); let DS components
  carry their own classes. (Preview layout glue must not depend on utilities that may not
  be in the compiled set — only ui/src classes are compiled.)
- **Overlays render open** (`open`/`defaultOpen`) and need `cfg.overrides.<Name> =
  {cardMode:"single", viewport:"WxH"}`: Dialog, ConfirmDialog, MenuDialog, DropdownMenu,
  Select, Tooltip. Tooltip also needs a `TooltipProvider` wrapper.
- **Toast** is an inline bar (not a portal), wide → `cardMode:"column"`.
- **InputField gotcha**: `showIcon`, `showDropdown`, `showTip` all default **true**, so a
  bare `<InputField label>` renders a search icon + chevron + "Tip Message"/"Badge".
  For plain form fields pass `showIcon={false} showDropdown={false} showTip={false}`.

## Per-component quirks (from preview authoring)

- **Skeleton** is `bg-card/10` (white @ 10% opacity) — **invisible on light surfaces**. Its
  preview wraps shapes in an inline dark card (`#2a2a2a`) so the pulse reads. Also: fixed-width
  Skeleton bars in a horizontal flex collapse to ~0 — give bars `flex-1`. (Future nicety: a
  provider setting a dark `--card`/page bg would remove the inline-dark-surface hack.)
- **Tabs** is a custom (non-Radix) controlled compound — it's the **tab strip only**, no built-in
  panel; panel content is a sibling. `<Tabs value onValueChange>` + `<Tab value>`; active = `bg-toast`.
- **Badge** `variant`: only `default | rounded | number` (`number` = red counter pill). No size prop.
- **Checkbox**/**Switch** are Radix-controlled — pass fixed `checked` (+ `checked="indeterminate"`
  for Checkbox) with a noop handler for static states. Switch `size`: `default | sm` (no lg).
- **SearchInput** mirrors its `value` prop into internal state — fixed `value` + noop `onChange`
  renders the static filled state with the clear (X) button.
- **CodeBlock** auto-selects the compact (header + icon-only copy) variant whenever `label` is set;
  bare (no label) is the wider `h-16` inline row.
- **CopyButton** "copied" state is interaction-only (3s timer) — previews show idle state.
- **LoadingState** has only `message`/`className` (fixed `Loader2 h-8 w-8` spinner) — vary message.
- **Pagination** (~720px) and CodeBlock fit the default grid width — no cardMode override needed.

## Known render warns

- `[FONT_REMOTE] "Inter"` — expected (host serves Inter at runtime; we @import Google Fonts).

## Re-sync risks

- **The compiled stylesheet is a CLOSED utility set.** `ds-preview.css` only contains the
  Tailwind utilities scanned from `packages/ui/src` at build time. If the UI source adds new
  utility classes, re-run `buildCmd` (it regenerates the CSS) before the converter — the driver
  does this. The conventions header tells the design agent to style its own layout with tokens
  (var(--*)), not arbitrary utilities, precisely because of this closed set.
- **Inter is fetched from Google Fonts at runtime** via a remote `@import` in `ds-preview.css`.
  If the design environment blocks external font hosts, previews/designs fall back to system-ui
  (still styled, just not literally Inter). To self-host instead, drop Inter woff2 + @font-face
  under `packages/ui` and switch `gen-preview-css.mjs` from the @import to `cfg.extraFonts`.
- **componentSrcMap is hand-maintained.** It excludes the 55 current sub-parts. A new root
  component's sub-parts won't be auto-excluded — add them, or they'll each get a (likely broken,
  context-less) card. Conversely a removed component leaves stale null entries (harmless).
- **Skeleton previews use a hardcoded `#2a2a2a` inline surface** (Skeleton is `bg-card/10`,
  invisible on white). If the DS ever ships a dark default surface or a provider, simplify those.
- **Build assumptions**: Node 18, npm workspaces, Playwright Chromium build 1223 (pinned by the
  repo's playwright 1.60.0), Tailwind v4.2.2 programmatic compile via `@tailwindcss/node` +
  `@tailwindcss/oxide` (real repo deps). `.ds-sync` converter deps: esbuild, ts-morph, @types/react.
- **This first sync was built but NOT uploaded** — the environment lacked Claude Design auth, so
  no project was created and `cfg.projectId` is unset. The next sync with auth creates the project
  (incremental path) and records `projectId`. The bundle in `ds-bundle/` is fully verified and
  upload-ready as-is.
