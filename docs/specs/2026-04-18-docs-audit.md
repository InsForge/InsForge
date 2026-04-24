# Spec: docs/ audit + minimal high-severity fixes (closes #1117)

**Date:** 2026-04-18
**Author:** Commander worker (insforge/commander/1117)
**Tier:** T2

## Problem

InsForge's `docs/` tree has ~65 non-deprecated `.mdx` pages. Ticket #1117 asks
for a systematic audit of these pages against the newly-vendored Mintlify
`doc-author` skill (at `.claude/skills/doc-author/`) and the InsForge overlay
at `.claude/skills/doc-author/INSFORGE.md`. Known-smell categories the ticket
calls out:

- Broken internal links to renamed/removed pages
- Navigation pointing at files that no longer exist
- Stale code examples diverging from the current SDK surface
- Deprecated APIs referenced from non-deprecated pages
- Vanilla-markdown where Mintlify components would be idiomatic
  (`> ⚠️` → `<Warning>`, fence groups → `<CodeGroup>`, `1. 2. 3.` → `<Steps>`)
- Frontmatter gaps per the InsForge overlay (`title`+`description` only;
  no `<ParamField>`; experimental features get `<Warning>` at top)

## Goals

1. Produce a single source-of-truth audit table at
   `docs/_audit-2026-04-18.md` listing every issue found, one row per
   `(page, issue)`, with severity and a recommended fix.
2. Apply **minimal-diff** fixes to the top five high-severity pages in the
   same PR. Every commit cites the anti-pattern from the skill.
3. File one follow-up GitHub issue per remaining high-severity page
   (assignee `tonychang04`, label `commander-ready`), and one catch-all
   issue for the combined medium/low-severity list.

## Non-goals

- Rewriting pages for style or tone. The skill explicitly favors
  minimal-diff.
- Touching anything under `docs/deprecated/`. Those are intentionally
  preserved.
- Source code changes. Audit is docs-only (`*.mdx`, `docs.json`, the new
  audit file itself).
- Restructuring navigation beyond removing dead entries or fixing typos
  — structure work is its own follow-up ticket.

## Proposed approach

1. **Read** every `.mdx` outside `docs/deprecated/` (found 65 files).
2. **Check** each against the categories above using targeted grep
   passes: link resolution, frontmatter shape, `<ParamField>` usage,
   markdown-warning patterns, emoji usage, fence groups, deprecated-API
   mentions.
3. **Cross-check** `docs/docs.json` navigation entries against the
   filesystem — missing target files are high-severity (they break
   navigation rendering).
4. **Cross-check** existing files against navigation — pages that exist
   but aren't reachable from nav are medium-severity orphans.
5. **Write** the audit table.
6. **Fix** the top five high-severity items with one commit per page,
   each commit message citing the skill section it enforces.
7. **File** follow-up issues via `gh issue create` per the ticket.

### Alternatives considered

- **Rewrite pages wholesale to match skill voice/tone.** Rejected: the
  skill and ticket both explicitly forbid this.
- **Skip the audit, just fix the obvious broken links.** Rejected: the
  ticket asks for the audit as the primary deliverable — the fixes are
  secondary. The audit becomes the roadmap for follow-up tickets.
- **Include medium/low fixes in this PR.** Rejected: would blow past the
  25-minute budget and dilute review focus. Catch-all follow-up issue
  keeps them tracked without blocking this PR.

## Test plan

- Manual: every link modified in this PR resolves to an existing file
  on disk (`test -f docs/<target>.mdx`).
- Manual: every page modified still parses as MDX (run `grep -c '^---$'`
  to verify frontmatter fences are balanced).
- Manual: `docs.json` is valid JSON after any edits (`jq empty`).
- Follow-up: a Mintlify CI check or local preview would catch any
  remaining nav/link regressions — out of scope for this PR.

## Risks / rollback

- **Risk:** removing a broken link from `changelog.mdx` might change
  rendered output in a way a reader already bookmarked. **Mitigation:**
  we repoint rather than delete where a valid destination exists (the
  SDK pages under `/sdks/typescript/*`).
- **Risk:** fixing `docs.json` might drop an intentional placeholder
  for future content. **Mitigation:** each nav entry we remove is
  confirmed to have zero matching `.mdx` in the tree; if the author
  intended a placeholder, they can re-add on the follow-up ticket.
- **Rollback:** revert the PR. All changes are docs-only; no runtime
  impact.
