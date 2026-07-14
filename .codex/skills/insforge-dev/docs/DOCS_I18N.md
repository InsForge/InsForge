# Translating the docs (Mintlify i18n)

The docs are a Mintlify site (`docs/docs.json`, `theme: mint`). Supported UI
languages: **en (default), zh (Simplified), zh-TW (Traditional/Taiwan), es**.

## How Mintlify localization works here

- **One folder per non-default locale**, mirroring the English tree:
  `docs/zh/<path>.mdx`, `docs/zh-TW/<path>.mdx`, `docs/es/<path>.mdx` for every
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
- Every English `docs/<p>.mdx` has `docs/{zh,zh-TW,es}/<p>.mdx`. Quick check:
  `scripts/check-docs-i18n-parity.sh` (fails if any locale is missing a page).
- Spot-check the rendered site: the language switcher lists all four, and a
  translated page renders with code blocks intact.

Blogs, changelogs, and customer stories are a separate CMS (insforge-cloud),
not these docs — do not translate them here.
