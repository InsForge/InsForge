# E2E Testing Skill Design

## Goal

Add an `e2e-testing` child skill under `insforge-dev` that agents use after finishing an InsForge OSS change and before opening, updating, or submitting the InsForge PR. The skill makes the deterministic cross-repo E2E gate explicit and repeatable.

## Placement

Create the skill under the existing InsForge repo skill surfaces:

- `.agents/skills/insforge-dev/e2e-testing/SKILL.md`
- `.codex/skills/insforge-dev/e2e-testing/SKILL.md`
- `.claude/skills/insforge-dev/e2e-testing/SKILL.md`

Update the parent `insforge-dev` skill in each surface so agents invoke `e2e-testing` during the pre-PR flow.

## Workflow

The skill should instruct agents to:

1. Finish local implementation and the existing InsForge pre-PR checks first.
2. Read the root InsForge `package.json` version and build a test tag by incrementing only the patch number:
   - `2.2.3` becomes `v2.2.4-<feature-or-issue-slug>`.
   - Ignore higher existing test tags when calculating the base version.
3. Sanitize the feature or issue slug to lowercase alphanumeric words separated by hyphens.
4. Dispatch InsForge's `Build and Push Docker Image` workflow with `test_tag=<tag>`.
5. Wait for the image workflow to complete successfully before starting E2E.
6. Inspect the InsForge change and decide whether deterministic fixture coverage in the remote `InsForge/agent-e2e` repo must change.
7. If no fixture change is needed, dispatch `Deterministic Fixture E2E` from `agent-e2e` main with `insforge_tag=<tag>`.
8. If fixture coverage must change, create or use a local checkout of the remote `InsForge/agent-e2e` repo, branch from `origin/main`, update validators/fixtures/docs, validate locally where practical, open an `agent-e2e` PR, then dispatch `Deterministic Fixture E2E` from that branch with `insforge_tag=<tag>`.
9. Wait for the deterministic workflow result.
10. If it passes, proceed with the InsForge OSS PR.
11. If it fails, inspect logs and artifacts, decide whether the failure belongs to the InsForge implementation, the `agent-e2e` fixture update, transient infrastructure, or an unrelated existing failure, then fix the correct branch or rerun with evidence.

The skill must ignore the `Support Desk Agent E2E (Exploratory)` workflow. It is not part of this gate.

## Boundaries

The skill should not replace local InsForge unit, lint, typecheck, or build validation. It is an additional release-quality gate for OSS PR submission.

The skill should not create or edit a local `agent-e2e` checkout unless the InsForge change affects behavior that deterministic fixture coverage should assert.

## Validation

Validate the new skill by checking that each copied `SKILL.md` has valid front matter and that the parent `insforge-dev` skill references the child skill consistently across `.agents`, `.codex`, and `.claude`.
