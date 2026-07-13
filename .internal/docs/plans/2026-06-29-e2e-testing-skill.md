# E2E Testing Skill Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add an `e2e-testing` child skill under `insforge-dev` so InsForge agents run the deterministic cross-repo E2E gate before submitting OSS PRs.

**Architecture:** Implement the workflow as a new child `SKILL.md` mirrored across `.agents`, `.codex`, and `.claude`. Add a parent `insforge-dev` pointer in each surface so agents know to invoke the child skill during the pre-PR phase.

**Tech Stack:** Markdown skill files, YAML front matter, GitHub CLI workflow commands, existing InsForge and `agent-e2e` GitHub Actions workflows.

---

## Task 1: Add The `e2e-testing` Child Skill

**Files:**
- Create: `.agents/skills/insforge-dev/e2e-testing/SKILL.md`
- Create: `.codex/skills/insforge-dev/e2e-testing/SKILL.md`
- Create: `.claude/skills/insforge-dev/e2e-testing/SKILL.md`

- [ ] **Step 1: Create the skill content**

Use the same content in all three files:

```markdown
---
name: e2e-testing
description: Use this skill when an InsForge maintainer has finished an OSS repo change and is ready to open, update, or submit the InsForge PR. Runs the release-quality deterministic E2E gate by building a package.json-derived InsForge test image tag, deciding whether sibling agent-e2e fixture coverage must change, dispatching the Deterministic Fixture E2E workflow, waiting for results, and triaging failures before PR submission.
---

# InsForge E2E Testing Gate

Use this skill after local implementation and normal InsForge pre-PR checks pass, and before opening, updating, or submitting the InsForge OSS PR.
```

- [ ] **Step 2: Include exact workflow instructions**

The body must cover package-version tag calculation, image build workflow dispatch, deterministic fixture dispatch, when to update `agent-e2e`, pass/fail triage, and the rule to ignore the support-desk workflow.

## Task 2: Link The Child Skill From `insforge-dev`

**Files:**
- Modify: `.agents/skills/insforge-dev/SKILL.md`
- Modify: `.codex/skills/insforge-dev/SKILL.md`
- Modify: `.claude/skills/insforge-dev/SKILL.md`

- [ ] **Step 1: Add `e2e-testing` to the child skill list**

Add `e2e-testing` beside the existing child skills.

- [ ] **Step 2: Add pre-PR invocation text**

Add a short pre-PR rule: after local checks pass and before opening, updating, or submitting an OSS PR, use `e2e-testing` to run the deterministic cross-repo gate.

## Task 3: Validate The Skill Markdown

**Files:**
- Inspect all changed skill files and the design/plan docs.

- [ ] **Step 1: Check front matter and trigger text**

Run:

```bash
sed -n '1,220p' .agents/skills/insforge-dev/e2e-testing/SKILL.md
sed -n '1,140p' .agents/skills/insforge-dev/SKILL.md
sed -n '1,140p' .codex/skills/insforge-dev/SKILL.md
sed -n '1,140p' .claude/skills/insforge-dev/SKILL.md
diff -u .agents/skills/insforge-dev/e2e-testing/SKILL.md .codex/skills/insforge-dev/e2e-testing/SKILL.md
diff -u .agents/skills/insforge-dev/e2e-testing/SKILL.md .claude/skills/insforge-dev/e2e-testing/SKILL.md
scripts/sync-skills.sh --check
```

Expected: the child skill has valid YAML front matter, the parent references `e2e-testing`, and mirrored child skills are identical.

- [ ] **Step 2: Check git diff**

Run:

```bash
git diff -- .agents/skills/insforge-dev .codex/skills/insforge-dev .claude/skills/insforge-dev docs/superpowers
```

Expected: only the new design/plan docs, the new child skill files, and the parent skill references changed.
