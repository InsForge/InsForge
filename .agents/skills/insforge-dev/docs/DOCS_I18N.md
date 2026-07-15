# Translating the docs (Mintlify i18n)

The docs are a Mintlify site (`docs/docs.json`, `theme: mint`). Supported UI
languages: **en (default), zh (Simplified), zh-Hant (Traditional), es**.
Use ONLY codes in Mintlify's docs.json schema enum (en|cn|zh|zh-Hans|zh-Hant|es|…).
`zh-TW` is NOT accepted — the CLI (`mint dev`) rejects it; Traditional must be
`zh-Hant`. Verify any new locale with `mint dev` before mass-translating.

## How Mintlify localization works here

- **One folder per non-default locale**, mirroring the English tree:
  `docs/zh/<path>.mdx`, `docs/zh-Hant/<path>.mdx`, `docs/es/<path>.mdx` for every
  English `docs/<path>.mdx`. Same filenames, same structure.
- **`docs.json` drives it, not the folders.** Navigation is a
  `navigation.languages` array — one entry per language, each with the FULL
  `tabs`/`groups` tree. English pages use bare paths (`introduction`); each
  locale's pages use the prefixed path (`zh/introduction`). Group/tab labels
  are translated per entry. A locale with translated files but no `languages`
  entry will NOT appear. The header language switcher is automatic.
- **Never reuse a page path across languages** — Mintlify says duplicate paths
  are undefined behavior. The `zh/` prefix guarantees uniqueness.
- Regenerate the nav after adding/moving English pages with
  `scripts/build-docs-langs.py` (prefixes paths + applies the label map); don't
  hand-edit the four language trees.

## Translating a page

Translate **prose, headings, list items, table cell text, callout/admonition
body text**, and the human-readable `title=""` / `description=""` attribute
VALUES on MDX components (`<Card>`, `<Tab>`, `<Accordion>`, `<Step>`, …). Also
translate the `title`/`description` frontmatter VALUES.

**Never translate:** code fences and their contents, inline `` `code` ``,
MDX/JSX component and prop NAMES, `import`/`<Snippet>` references, URLs and file
paths, API/method/SQL/env-var names, brand/product names (InsForge, PostgreSQL,
Stripe, OpenRouter, Next.js, …), CLI commands, `openapi` specs (the API
Reference tab is auto-generated and stays shared/English), and any
`data-for-agents` block (that prose addresses AI agents — keep it English).

Preserve MDX structure, indentation, and blank lines exactly — only
natural-language text changes. No summarizing, adding, or dropping content.

## Fan-out translation (large batches)

For a full-site pass, split the `.mdx` list into balanced groups and dispatch
one subagent per group at a **cheap model tier (haiku)** — the work is
mechanical. Each agent writes all three locale copies for its files. Then run
the parity + build check below. (This is exactly how the initial zh/zh-TW/es
pass was done.)

## Verify

- `npx mint broken-links` (or the repo's docs build) — no broken links, all
  `languages` paths resolve.
- `scripts/check-docs-i18n-parity.sh` validates against docs.json: every nav
  path resolves, every non-en nav entry is locale-prefixed (no silent English
  fallback), and every English nav page has a translated file in all 3 locales.
- Spot-check the rendered site: the language switcher lists all four, and a
  translated page renders with code blocks intact.

Blogs, changelogs, and customer stories are a separate CMS (insforge-cloud),
not these docs — do not translate them here.

Snippets (`snippets/*.mdx`) are NOT localized: pages import them by absolute
path (`/snippets/x.mdx`), which always resolves to English, so per-locale
snippet copies would be dead files. Leave snippet includes English.
