# `.claude/skills/` — contributor skill library

Claude Code (and compatible agents) auto-discover skills here. Each subdirectory
is one skill; a skill's entry point is `SKILL.md`, which starts with YAML
frontmatter containing at minimum `name` and `description`.

## Current skills

| Skill | Entry point | Purpose |
|---|---|---|
| `insforge-dev` | `insforge-dev/SKILL.md` | Maintainers working in this monorepo (backend, dashboard, UI, shared schemas, docs). **Mirrored copy — the canonical source is [`.agents/skills/insforge-dev/`](../../.agents/skills/insforge-dev/); do not edit here.** |
| `doc-author` | `doc-author/SKILL.md` | Writing and maintaining `docs/*.mdx` pages. **Vendored from [mintlify/docs](https://github.com/mintlify/docs) — see upstream SHA in the attribution block.** InsForge-specific conventions live next to it in [`doc-author/INSFORGE.md`](doc-author/INSFORGE.md). |

## Adding a new skill

1. Create `<skill-name>/SKILL.md` with `name` + `description` frontmatter.
2. Add the directory to the `.gitignore` allow-list at the repo root
   (the root-level rules hide `.claude/*` by default).
3. Update this README with a one-line entry.

## Editing the `insforge-dev` skill

`insforge-dev` is mirrored across three agent directories (`.claude/`, `.codex/`,
`.agents/`) because each agent only discovers skills from its own directory. To
avoid drift, **`.agents/skills/insforge-dev/` is the single source of truth** and
the other two are generated copies.

1. Edit only `.agents/skills/insforge-dev/**`.
2. Run `scripts/sync-skills.sh` to regenerate the `.claude/` and `.codex/` copies.
3. Commit all three trees together.

CI (`scripts/sync-skills.sh --check` in `.github/workflows/lint-and-format.yml`)
fails if the copies drift from the canonical source. (Symlinks would avoid the
duplication but break on Windows checkouts and trip Prettier, so real copies it
is — until agents agree on a shared skill location.)

## Updating the vendored `doc-author` skill

`doc-author/SKILL.md` is a verbatim copy of Mintlify's upstream. To refresh:

```bash
scripts/update-mintlify-skill.sh
```

The script re-downloads the upstream file, updates the commit SHA in the
attribution header, and fails loudly if Mintlify's license has changed from MIT
— in which case the vendoring posture needs review before committing. Do not
hand-edit `doc-author/SKILL.md`; put InsForge-specific overrides in
`doc-author/INSFORGE.md` instead.
