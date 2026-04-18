---
name: write-mintlify-docs
description: Use this skill when writing or updating InsForge Mintlify documentation under `docs/*.mdx`. Triggers include "write docs for X", "update the Mintlify page", "add an API reference page", or any edit that creates/modifies a `.mdx` file or changes `docs/docs.json` navigation. Teaches the exact frontmatter, components, and house style the repo already uses — survey-first, never invent.
---

# Write Mintlify Docs

Use this skill when authoring or editing any file under `docs/` in the InsForge repo — `.mdx` pages, `docs/docs.json` navigation, or `docs/snippets/*`. It exists to prevent drift between the docs you write and the patterns InsForge already ships.

## When to use

- Adding a new page under `docs/` (product, core-concepts, SDK reference, examples).
- Updating an existing `.mdx` file (new section, component swap, tone fix).
- Adding or reorganizing entries in `docs/docs.json`.
- Reviewing a docs PR for pattern conformity.

Do NOT use for: `docs/agent-docs/**` (agent-only instructions — see `insforge-dev/docs`), `README.md`, or `openapi/**`.

## Survey before writing (mandatory)

Mintlify exposes dozens of components. InsForge only uses a subset, so documenting an unused one teaches agents to reach for the wrong tool. Before writing, confirm the component you want is already live in the repo:

```bash
# Component inventory — which MDX components does InsForge actually use?
grep -rn "^<\(Warning\|Note\|Tip\|Info\|Check\|Steps\|Step \|CodeGroup\|Tabs\|Tab \|Card \|CardGroup\|Accordion\|AccordionGroup\|Frame\|Update\)" docs/ --include="*.mdx"

# Frontmatter keys actually in use (should only be title + description)
awk '/^---$/{f=!f; next} f && /^[a-z]/{print FILENAME":"$0}' docs/**/*.mdx | sort -u
```

If a component doesn't appear anywhere, treat it as "available but unused" — link to Mintlify's upstream docs (`https://mintlify.com/docs`) rather than documenting a shape the repo hasn't validated.

## MDX fundamentals

Every page starts with YAML frontmatter containing exactly two keys: `title` and `description`. No `sidebarTitle`, `icon`, `mode`, `api`, or `openapi` are used anywhere in `docs/`.

```mdx
---
title: "MCP Setup"
description: "Manual MCP configuration for AI coding assistants"
---
```

Quoting is mixed — `docs/introduction.mdx:2-3` and `docs/mcp-setup.mdx:2-3` use double-quoted strings, while `docs/core-concepts/deployments/architecture.mdx:2-3` and `docs/core-concepts/authentication/architecture.mdx:2-3` are unquoted. Match whatever style the directory you're editing already uses.

Imported snippets use `import X from '/snippets/<file>.mdx'` (absolute path from docs root), then render as `<X />`. See `docs/core-concepts/realtime/sdk.mdx:6` and `docs/snippets/sdk-installation.mdx`.

## Component cookbook

Every example below is a pattern InsForge already ships. Copy the shape verbatim — do not introduce new props.

### Callouts — `<Warning>`, `<Note>`, `<Tip>`, `<Info>`

```mdx
<Warning>
  Deployments is an experimental feature. APIs and behavior may change.
</Warning>
```

- `<Warning>` for stability/breaking-change warnings — `docs/core-concepts/deployments/architecture.mdx:6`, `docs/core-concepts/email/architecture.mdx:6`, `docs/core-concepts/functions/schedules.mdx:91`.
- `<Note>` for informational asides — `docs/core-concepts/deployments/architecture.mdx:134`, `docs/core-concepts/realtime/sdk.mdx:20`.
- `<Tip>` for helpful alternatives — `docs/mcp-setup.mdx:10`, `docs/core-concepts/database/pgvector.mdx:70`.
- `<Info>` for product-scope call-outs like enterprise options — `docs/core-concepts/storage/architecture.mdx:10`.

### `<CodeGroup>` — multi-language code tabs

Language tab labels go after the fence language — e.g. `` ```bash npm ``, `` ```javascript Single insert ``. Live at `docs/snippets/sdk-installation.mdx:1` and `docs/sdks/typescript/database.mdx:37`.

```mdx
<CodeGroup>
```bash npm
npm install @insforge/sdk@latest
```

```bash pnpm
pnpm add @insforge/sdk@latest
```
</CodeGroup>
```

### `<Steps>` + `<Step title="…">` — ordered procedures

Used for setup flows like `docs/vscode-extension.mdx:30-31` and `docs/core-concepts/realtime/architecture.mdx:298-299`. Nest callouts, code fences, or images inside a `<Step>`.

```mdx
<Steps>
  <Step title="Open the InsForge panel">
    Click the **InsForge** icon in the Activity Bar (left sidebar).
  </Step>
  <Step title="Login">
    Click **Login with InsForge** and complete the login flow in your browser.
  </Step>
</Steps>
```

### `<CardGroup>` + `<Card>` — feature grids and link collections

Always inside `<CardGroup cols={2}>` (or `cols={1}` / `cols={3}`) — see `docs/introduction.mdx:22`, `docs/core-concepts/database/architecture.mdx:85`, `docs/core-concepts/ai/architecture.mdx:261`. Each `<Card>` takes `title`, `icon`, `href`.

```mdx
<CardGroup cols={2}>
  <Card title="PostgreSQL Database" icon="database" href="/core-concepts/database/architecture">
    Tables become APIs instantly. No code. Just schema.
  </Card>
  <Card title="Authentication" icon="shield" href="/core-concepts/authentication/architecture">
    User signup, login, sessions, OAuth. Zero configuration.
  </Card>
</CardGroup>
```

### `<AccordionGroup>` + `<Accordion title="…">` — collapsible sections

Used for per-client setup guides (`docs/mcp-setup.mdx:25-26`, `docs/mcp-setup.mdx:483`) and troubleshooting entries (`docs/mcp-setup.mdx:669`).

### `<Tabs>` + `<Tab title="…">` — parallel variants

Used when content differs by audience (`docs/partnership.mdx:95-96`) or flow (`docs/oauth-server.mdx:198`). Prefer `<CodeGroup>` for code-only tabs.

### `<Frame>` — wrap images or videos

Use for screenshots and video embeds — `docs/mcp-setup.mdx:39` (video), `docs/changelog.mdx:11` (img), `docs/changelog.mdx:19` (video with autoPlay).

### `<Update>` — changelog entries only

One consumer: `docs/changelog.mdx:6`. Shape: `<Update label="Dec 21, 2025" tags={["Realtime", "Auth"]}>`. Do not use elsewhere.

### Mermaid diagrams

Architecture pages use `` ```mermaid `` code blocks for stack diagrams — `docs/core-concepts/storage/architecture.mdx:16`, `docs/core-concepts/deployments/architecture.mdx:16`, `docs/core-concepts/functions/architecture.mdx`, `docs/core-concepts/realtime/architecture.mdx`, `docs/partnership.mdx`. No extra component wrapper — the code fence alone renders.

## Navigation (`docs/docs.json`)

All pages must be registered in `docs/docs.json` or they will not appear in the sidebar. The file is a Mintlify config with `navigation.tabs[].groups[].pages[]` — pages are listed by slug (path without `.mdx` and without leading `/docs`). Groups can nest.

To add a new page:

1. Create the `.mdx` file under `docs/<section>/<slug>.mdx`.
2. Open `docs/docs.json`, find the correct `group` under `navigation.tabs[0].groups`, and add the slug to `pages`.
3. For a new sub-section, add a nested group object with its own `group` and `pages`.

## InsForge style rules

Derived from reading the existing corpus — each rule is followed by the evidence that makes it a rule.

- **Second-person imperative.** "Follow the instructions below for your AI client." — `docs/mcp-setup.mdx:14`. "Chain `.select()` after `.insert()` to return the inserted data" — `docs/sdks/typescript/database.mdx:32`.
- **`title` + `description` frontmatter only.** Every `.mdx` file opens with those two keys and nothing else — `docs/introduction.mdx:2-3`, `docs/mcp-setup.mdx:2-3`, `docs/core-concepts/storage/architecture.mdx:2-3`.
- **Mark experimental features with `<Warning>` at top of file.** Both Deployments (`docs/core-concepts/deployments/architecture.mdx:6`) and Email (`docs/core-concepts/email/architecture.mdx:6`) open with the same shape: "X is an experimental feature. APIs and behavior may change."
- **Callouts sit inside prose, not as the first thing after a heading.** `<Note>` and `<Tip>` follow an explanatory sentence — e.g. `docs/core-concepts/realtime/sdk.mdx:20` sits under "Establish a WebSocket connection…" not as a bare header.
- **Language-label CodeGroup tabs with short names.** "npm", "pnpm", "Single insert", "Bulk insert" — `docs/snippets/sdk-installation.mdx:2-11`, `docs/sdks/typescript/database.mdx:38-53`. Not filenames.
- **SDK reference pages import the installation snippet.** `docs/core-concepts/realtime/sdk.mdx:6` and `docs/core-concepts/storage/sdk.mdx:6` both `import Installation from '/snippets/sdk-installation.mdx'` then render `<Installation />`. Do not inline install commands in SDK reference pages.

## Anti-patterns

| Don't write | Use instead | Why |
|---|---|---|
| `<details><summary>…` | `<Accordion title="…">` inside `<AccordionGroup>` | Raw HTML `<details>` is never used in `docs/` — grep returns zero hits. |
| Three sibling fenced code blocks for npm/yarn/pnpm | `<CodeGroup>` with labeled fences | Every install guide uses the `<CodeGroup>` shape — `docs/snippets/sdk-installation.mdx:1`. |
| `> **Note:** …` blockquote | `<Note>…</Note>` | Blockquotes render as quotes, not callout boxes. The codebase uses the component. |
| Frontmatter with `icon:` or `sidebarTitle:` | `title` + `description` only | No `.mdx` in `docs/` uses these keys. |
| New page file committed without `docs.json` entry | Register in `docs/docs.json` at time of page creation | Orphan pages 404 from the sidebar even if the file deploys. |
| `<ParamField>` / `<ResponseField>` API-reference components | Plain headings + bullet lists (see `docs/sdks/typescript/database.mdx`) | These Mintlify components are not used anywhere in this repo. Adopting them would fragment the reference style. |

## Verification

Before pushing:

1. `npx mintlify dev` from repo root (Mintlify CLI — installs on first run). Confirm the new/changed page loads and the sidebar entry appears.
2. `npx mintlify broken-links` — flag any internal hrefs that 404.
3. For any new page: confirm it appears in `docs/docs.json` under the correct group.
4. `git diff docs/docs.json` — verify the navigation edit is additive (no accidental deletions).

## Example — good and bad

**Bad** — frontmatter drift, raw HTML, inline install:

```mdx
---
title: Email SDK
icon: "envelope"
sidebarTitle: Email
---

> Note: This is experimental.

<details>
  <summary>Installation</summary>
  <pre>npm install @insforge/sdk</pre>
</details>
```

**Good** — two-key frontmatter, `<Warning>` for experimental status, imported snippet, `<CodeGroup>` not raw fences:

```mdx
---
title: Email SDK Reference
description: Send transactional email with the InsForge SDK
---

<Warning>
  Email is an experimental feature. APIs and behavior may change.
</Warning>

import Installation from '/snippets/sdk-installation.mdx';

<Installation />

## send()

Send a transactional email to one or more recipients.

<CodeGroup>
```javascript Single recipient
await insforge.email.send({ to: 'user@example.com', subject: 'Hi' })
```

```javascript Bulk
await insforge.email.send({ to: ['a@x.com', 'b@x.com'], subject: 'Hi' })
```
</CodeGroup>
```
