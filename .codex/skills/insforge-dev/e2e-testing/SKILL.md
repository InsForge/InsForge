---
name: e2e-testing
description: Use this skill when an InsForge maintainer has finished an OSS repo change and is ready to open, update, or submit the InsForge PR. Runs the release-quality deterministic E2E gate by building a package.json-derived InsForge test image tag, deciding whether sibling agent-e2e fixture coverage must change, dispatching the Deterministic Fixture E2E workflow, waiting for results, and triaging failures before PR submission.
---

# InsForge E2E Testing Gate

Use this skill after local implementation and normal InsForge pre-PR checks pass, and before opening, updating, or submitting the InsForge OSS PR.

This is an additional release-quality gate. It does not replace local `typecheck`, `lint`, `test`, or `build` validation from the parent `insforge-dev` skill.

## Repositories

- InsForge OSS repo: current workspace.
- E2E repo: remote GitHub repository `InsForge/agent-e2e`.

Use the remote `InsForge/agent-e2e` repository for workflow dispatch and read-only workflow checks. Do not rely on a developer-specific local checkout path. Create or use a local checkout only when the deterministic fixture tests must be edited.

## Build The Test Tag

1. Read the root InsForge `package.json` version.
2. Increment only the patch number.
3. Build a tag in this form:

```text
v<major>.<minor>.<patch+1>-<feature-or-issue-slug>
```

Example: root version `2.2.3` and feature `storage returning rls` becomes `v2.2.4-storage-returning-rls`.

Use the `package.json` version as the only source of truth for the base version. Ignore higher existing test tags when calculating the base version.

Slug rules:

- Prefer the issue key, PR topic, or branch topic.
- Lowercase all letters.
- Replace runs of non-alphanumeric characters with one hyphen.
- Trim leading and trailing hyphens.
- Keep it short enough to scan in GitHub Actions and image tags.

## Build The InsForge Image

Dispatch the InsForge `Build and Push Docker Image` workflow with the test tag:

```bash
gh workflow run "Build and Push Docker Image" --repo InsForge/InsForge --ref <insforge-feature-branch> -f test_tag=<test-tag>
```

Then wait for the matching run to complete:

```bash
gh run list --repo InsForge/InsForge --workflow "Build and Push Docker Image" --limit 10
gh run watch --repo InsForge/InsForge <run-id>
```

Do not start the cross-repo E2E workflow until the image build succeeds.

## Decide Whether `agent-e2e` Must Change

Inspect the InsForge diff and compare it with deterministic fixture coverage in `InsForge/agent-e2e`.

For read-only checks, prefer remote GitHub access such as `gh api`, `gh repo view`, or remote file reads. Use a local checkout only when editing fixture files or when remote inspection is not enough to understand coverage.

Update `agent-e2e` when the InsForge change adds, removes, or changes behavior that the deterministic fixture should assert, including:

- API contract or validation behavior.
- Auth, permissions, RLS, storage, realtime, functions, schedules, AI, SDK, or CLI-visible behavior.
- Any regression that local tests cover but the release gate should also protect across the deployed runtime.

Do not update `agent-e2e` for internal refactors, docs-only changes, local test-only changes, or behavior already covered by the deterministic fixture with no assertion change needed.

Ignore `Support Desk Agent E2E (Exploratory)`. It is not part of this gate.

## If No E2E Test Update Is Needed

Run the deterministic fixture workflow from `agent-e2e` main:

```bash
gh workflow run "Deterministic Fixture E2E" --repo InsForge/agent-e2e --ref main -f insforge_tag=<test-tag>
```

Find and watch the run:

```bash
gh run list --repo InsForge/agent-e2e --workflow "Deterministic Fixture E2E" --limit 10
gh run watch --repo InsForge/agent-e2e <run-id>
```

## If E2E Tests Need An Update

Work in a local checkout of the remote `InsForge/agent-e2e` repo only for the fixture update.

1. Use an existing clean checkout or clone `https://github.com/InsForge/agent-e2e.git` into an isolated workspace.
2. Fetch `origin` and start from `origin/main`.
3. Create a branch named `codex/<short-topic>`.
4. Update only the deterministic fixture validators, fixtures, app assertions, and docs needed for the InsForge behavior change.
5. Run the smallest local validation that gives confidence:

```bash
npm run typecheck
npm run lint
npm run fixture:e2e:dry
```

Run broader validation when the changed fixture area supports it.

6. Open an `agent-e2e` PR for the fixture update.
7. Dispatch the deterministic fixture workflow from the `agent-e2e` branch that contains the fixture update:

```bash
gh workflow run "Deterministic Fixture E2E" --repo InsForge/agent-e2e --ref <agent-e2e-branch> -f insforge_tag=<test-tag>
```

8. Watch the run before proceeding with the InsForge PR.

## Interpret Results

If the deterministic fixture workflow passes:

- Link the run in the InsForge PR body or final PR notes.
- If an `agent-e2e` PR was required, link that PR too.
- Proceed with opening, updating, or submitting the InsForge OSS PR.

If the deterministic fixture workflow fails:

1. Inspect the failed job logs and uploaded artifact.
2. Identify whether the failure is caused by the InsForge implementation, the new or existing deterministic fixture, a transient infrastructure problem, or an unrelated existing failure.
3. Fix the correct branch:
   - InsForge implementation bug: update the InsForge branch, rebuild the test image with the same tag or a new short retry tag, then rerun E2E.
   - Fixture bug or missing assertion update: update the `agent-e2e` branch, rerun local validation, then rerun E2E from that branch.
   - Transient infrastructure issue: rerun once after noting the evidence.
4. Do not submit the InsForge PR until the deterministic result is clear or the user explicitly accepts the risk.

## Report Back

When finished, report:

- Test tag used.
- InsForge image workflow run result.
- Whether `agent-e2e` changed.
- Deterministic Fixture E2E run result.
- Links to the InsForge PR, `agent-e2e` PR if any, and workflow runs.
