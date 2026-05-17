# InsForge overlay — doc-author conventions

Local overlay for the vendored Mintlify [`doc-author` skill](./SKILL.md).
Upstream prose is authoritative; the items below are InsForge-specific and
override upstream advice only where they conflict.

## Information architecture

### Top-level sidebar groups

`docs/docs.json` uses these top-level groups in this order under the `Docs` tab:

1. **Getting Started** — `introduction`, `quickstart`, `mcp-setup`
2. **Products** — `expanded: true`, one nested group per product
3. **Partnership** — `partnership`, `oauth-server`
4. **Self-Hosting** — deployment guides + `config-as-code`
5. **Resources** — `showcase`, `changelog`

`expanded: true` on a parent group makes it render as a section header that
stays open. Use it for **Products** so every product is visible at a glance.

### Product nesting: one group per product, `overview` first

Each product is a nested group inside **Products**. The first page in every
product group is `core-concepts/<product>/overview` and its `sidebarTitle`
in frontmatter is `"Overview"` (not the product name). The page itself uses
`title: "<Product>"` for the H1.

```jsonc
{
  "group": "Database",
  "pages": [
    "core-concepts/database/overview",
    "core-concepts/database/architecture",
    "core-concepts/database/migrations",
    "core-concepts/database/branching",
    "core-concepts/database/pgvector"
  ]
}
```

Clicking the product name in the sidebar expands the group; the first child
("Overview") is what the user lands on. Do **not** try to make the group
label itself link to a page — Mintlify's `root` property is unreliable for
nested groups and produces a worse experience than the overview-first
pattern.

### Private-preview products live inside Products

Private-preview modules (Email, Payments, Compute) belong inside **Products**
with `(Private Preview)` suffixed to the group label. Do not create a
separate top-level "Private Preview" group.

## Overview page template

Every product has `core-concepts/<product>/overview.mdx`. Every overview
imports and renders the shared `AgentPrereq` snippet at the very top of the
body, between frontmatter and the lead paragraph. Follow this
Supabase+Appwrite hybrid pattern:

```mdx
---
title: "Database"
sidebarTitle: "Overview"
description: "Use InsForge to manage your data."
---

import AgentPrereq from '/snippets/agent-prereq.mdx';

<AgentPrereq />

Every InsForge project comes with a full [Postgres](https://www.postgresql.org/) database. Tables become typed REST and SDK surfaces. Auth tokens scope every read and write through row-level security. The same Postgres handles relational workloads, semantic search via pgvector, and realtime change feeds.

<Note>
  **Looking for file storage?** Use [Storage](/core-concepts/storage/overview) for images, PDFs, and other binary content. The database stores rows; storage stores objects.
</Note>

## Features

### Tables as APIs
...

### Migrations
...

## Concepts

<CardGroup cols={2}>
  <Card title="Architecture" icon="diagram-project" href="/core-concepts/database/architecture">
    How Postgres, PostgREST, and the SDK fit together.
  </Card>
  ...
</CardGroup>

## Build with it

<CardGroup cols={2}>
  <Card title="TypeScript SDK" icon="js" href="/sdks/typescript/database">...</Card>
  <Card title="Swift SDK" icon="swift" href="/sdks/swift/database">...</Card>
  <Card title="Kotlin SDK" icon="android" href="/sdks/kotlin/database">...</Card>
  <Card title="REST API" icon="code" href="/sdks/rest/database">...</Card>
</CardGroup>

## Next steps

- Read the [InsForge Quickstart](/quickstart) to link the CLI to your project.
- Set up [MCP](/mcp-setup) so your agent can read schemas and run queries.
- Browse the [TypeScript SDK reference](/sdks/typescript/database) for typed queries.
```

Section order: **lead paragraph → optional `<Note>` callout(s) → `## Features`
(H3 per capability, one short paragraph each) → `## Concepts` (CardGroup of
sub-pages) → `## Build with it` (CardGroup of SDK pages; omit on products
with no SDK such as Deployments and Compute) → `## Next steps` (bullet
list with Quickstart, MCP setup, and the TypeScript SDK reference)**.

The lead paragraph names the underlying technology (Postgres, Deno,
OpenRouter, etc.) and three concrete capabilities in plain language. No
marketing adjectives.

### Name what you store, especially for adjacent products

Supabase and Appwrite both open their Storage docs by naming the file types
("images, videos, documents", "any type of digital content"). Do the same on
InsForge overview pages whenever a sibling product could be confused with
this one. The lead and the `<Note>` callout should together make the
boundary obvious:

- **Storage** lead: "large binary files: images, videos, PDFs, audio,
  backups, anything you would not put in a database row." Note points to
  Database for rows.
- **Database** lead: relational rows, semantic search, change feeds. Note
  points to Storage for binary content.
- **Realtime** vs **Edge Functions**: realtime is for subscriptions to row
  changes and pub/sub; edge functions are for running code. Cross-link.
- **Model Gateway** vs **Edge Functions**: gateway is the proxy to model
  providers; functions are where you orchestrate the calls. Cross-link.

The pattern is: lead sentence answers "what do I put in here?", `<Note>`
answers "this is not the product I want — where do I go?"

- `docs/core-concepts/database/overview.mdx` — canonical example
- `docs/core-concepts/functions/overview.mdx` — minimal example for products
  with fewer sub-pages

## Frontmatter: `title` + `sidebarTitle` + `description`

Overview pages use **three** frontmatter keys:

- `title` — H1 of the page (the product name, e.g. `"Database"`)
- `sidebarTitle` — `"Overview"` (so the sidebar reads `Database > Overview`)
- `description` — one short sentence; no period, no marketing

All other pages use only `title` and `description`. Do not add `icon` or
other Mintlify-supported keys unless a neighbouring page already does.

- `docs/quickstart.mdx:1-4` — non-overview canonical example
- `docs/core-concepts/database/overview.mdx:1-5` — overview canonical example

## Theme

`docs/docs.json` uses:

- `theme: "mint"`
- `colors.primary: "#07C983"` (mint green, matches the InsForge Cloud
  dashboard "Connect" button — **not** the blue gradient from the logo and
  **not** Tailwind green)
- `colors.light: "#4ADE80"`, `colors.dark: "#059669"`
- `appearance.default: "dark"`

Do not change these without a screenshot comparing both themes against the
dashboard.

## Voice: do not sound like AI

Match Supabase and Appwrite docs prose. Specifically:

- **No em-dashes.** Use commas, periods, colons, or parentheses. Hyphens in
  compound words (`row-level`, `low-latency`) are fine.
- **No marketing adjectives.** Avoid "seamless", "powerful", "robust",
  "comprehensive", "enterprise-grade", "next-generation", "cutting-edge".
- **No AI tells.** Avoid "delve", "leverage", "unlock", "empower", "tapestry",
  "navigate the landscape", "in today's world".
- **No throat-clearing.** Start with the noun, not "Welcome to...", "In this
  guide...", or "Let's explore...".
- **Sentence-case headings.** `## Next steps`, not `## Next Steps`.
- **Second-person imperative.** Address the reader as "you"; use imperative
  verbs. See `docs/quickstart.mdx` for the canonical voice.
- **One concrete sentence beats two abstract ones.** Name the technology,
  the file, the command.

## Framework guides: link to both CLI and MCP

Every framework guide in `docs/examples/framework-guides/*.mdx` mentions
**both** entry points in Step 2:

- CLI setup (link to `/quickstart`)
- MCP setup (link to `/mcp-setup`)

Do not have a framework guide link only to one, and never have a step that
links back to itself or to a sibling framework guide.

- `docs/examples/framework-guides/nextjs.mdx` — canonical example

Supported framework guides: Next.js, React, Vue, Nuxt, Svelte. Keep this set
minimal; do not add a guide unless we have a working SDK example.

## Product naming

Use these names exactly in prose, frontmatter `title`, sidebar group labels,
and card titles. The names match `README.md` and the InsForge Cloud
dashboard:

| Use this              | Not this                            |
| --------------------- | ----------------------------------- |
| Database              | Postgres, DB, Tables                |
| Authentication        | Auth (in body prose), Identity      |
| Storage               | Files, Object Storage, S3 (alone)   |
| Realtime              | Pub/Sub, Channels, WebSockets       |
| Edge Functions        | Functions, Serverless, Lambdas      |
| **Model Gateway**     | **AI Gateway**, LLM Gateway, AI     |
| Deployments / Site Deployment | Hosting, Frontends, Pages   |
| Messaging             | Email (the product), Mail, SMTP, Transactional Email |
| Payments              | Billing, Stripe, Checkout           |
| Compute               | Containers, Workers, Long-running   |

"Edge functions" (lowercase f) is fine in body prose; titles and sidebar
labels use Title Case ("Edge Functions"). "Model Gateway" stays
title-cased everywhere because it is a product name, not a generic noun.

The Messaging product currently ships only the **Email** channel; SMS and
Push are stubbed as "Coming soon" cards on `core-concepts/messaging/overview`.
Refer to **Messaging** when you mean the product, **Email** when you mean
the channel. The directory and SDK pages (`sdks/*/email`) stay named
`email` because they document the channel-specific API surface.

## No `<ParamField>` — bullet lists for parameters

The repo has zero `<ParamField>` usage. Document parameters as plain markdown
bullet lists under a `### Parameters` heading.

- `docs/sdks/typescript/auth.mdx:17-22` — canonical pattern

## Shared snippet: `<AgentPrereq />` on every product overview

Every product overview imports the agent-prereq snippet at the top of the
body. Its job is to remind first-time readers to wire up MCP (or the CLI)
before they try to use the product:

```mdx
import AgentPrereq from '/snippets/agent-prereq.mdx';

<AgentPrereq />
```

- Snippet body: `docs/snippets/agent-prereq.mdx`
- Renders above the lead paragraph, before any product-specific `<Note>`
- Do **not** render this on sub-pages (architecture, migrations, etc.); one
  reminder per product is enough
- Edit the snippet, not the call sites, when the prereq message changes

## SDK install = import the snippet, never inline

Every page that shows an SDK install imports the shared snippet:

```mdx
import Installation from '/snippets/sdk-installation.mdx';

<Installation />
```

- Snippet body: `docs/snippets/sdk-installation.mdx`
- Usage: `docs/sdks/typescript/auth.mdx:7-10`,
  `docs/core-concepts/storage/sdk.mdx:6-8`,
  `docs/examples/framework-guides/react.mdx:6`

## Hidden agent breadcrumb on `introduction.mdx`

`docs/introduction.mdx` carries a visually hidden `<div data-for-agents>`
block that points AI agents at `https://insforge.dev/skill.md` for the
canonical setup workflow. Keep this block on the overview page only and do
not duplicate it elsewhere; multiple copies make agents fetch the skill on
every page load.

- `docs/introduction.mdx:6-20` — canonical block
