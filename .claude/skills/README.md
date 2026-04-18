# InsForge repo-local contributor skills

This directory holds **contributor-facing skills** — reference procedures that a human or AI contributor reads when editing the InsForge monorepo. Each skill teaches one narrow thing: "how to author a doc page that matches house style", "how to change backend code without breaking the SDK contract", etc.

Skills here are distinct from:

- **User-facing skills** at `InsForge/insforge-skills` — those teach end users how to *build apps on InsForge*, not how to contribute to this repo.
- **The `docs/` corpus** — those are product docs for users. Skills are contributor playbooks.

## How skills are loaded

A Claude Code (or compatible) agent running in this worktree discovers these skills automatically via the `.claude/skills/` convention. An agent reads `SKILL.md` up-front as part of orientation.

You can also invoke a skill by name in a prompt, e.g. "Use the write-mintlify-docs skill to add a page for the new email API."

## Current skills

| Skill | When to use |
|---|---|
| [`insforge-dev/`](./insforge-dev/SKILL.md) | Umbrella entry for any edit inside this repo — routes to `backend`, `dashboard`, `ui`, `shared-schemas`, or `docs` sub-skills. |
| [`write-mintlify-docs/`](./write-mintlify-docs/SKILL.md) | Authoring or updating any `.mdx` file under `docs/`, or editing `docs/docs.json`. Teaches the component cookbook, frontmatter, and house style InsForge already ships. |

## Skill shape

Every skill lives at `.claude/skills/<kebab-name>/SKILL.md` with this frontmatter:

```markdown
---
name: <kebab-name>
description: One paragraph. Be specific about triggers — the loader matches against this text to decide whether to surface the skill.
---

# <Skill Title>

## When to use
Bullet list of explicit trigger conditions.

## <Topic sections>
Each section is an atomic action or reference. Cite real `file:line` for
every claim about existing code or docs.

## Anti-patterns
Pairs of "don't write X, use Y because Z."

## Verification
How a contributor confirms their change conforms to the skill.
```

Keep each `SKILL.md` under ~200 lines. If a skill grows beyond that, split into multiple skills or move reference material into sibling files inside the same directory.

## Authoring checklist

1. Pick a name — `kebab-case`, specific, describes the action. `write-mintlify-docs`, not `docs-helper`.
2. Create `.claude/skills/<name>/SKILL.md` matching the shape above.
3. Survey the repo for real examples before writing. Every concrete claim in the skill ("the repo uses X") must be backed by a `file:line` citation.
4. Add an entry to the "Current skills" table in this README.
5. If `.claude/skills/<name>/` needs to be git-tracked, add an allow-list entry to `.gitignore` so it survives the default `.claude/*` ignore (see existing `!.claude/skills/insforge-dev/` pattern).

## When NOT to add a skill

- The behavior is already covered by an upstream skill (e.g. a gstack or superpowers skill installed globally at `~/.claude/skills/`). Reuse those.
- The guidance is one-shot and won't repeat across tickets. Put it in the relevant commit or PR description instead.
- It duplicates `CLAUDE.md` or a doc page under `docs/`. Link or move content instead of restating.
