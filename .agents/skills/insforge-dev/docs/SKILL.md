---
name: docs
description: Use this skill when contributing to InsForge's product documentation in this repository. This is for maintainers editing public docs in `docs/core-concepts`, agent docs in `docs/agent-docs`, SDK integration guides in `docs/sdks`, and OpenAPI specs in `openapi`.
---

# InsForge Dev Docs

Use this skill for `docs/core-concepts/`, `docs/agent-docs/`, `docs/sdks/`, and `openapi/` in the InsForge repository.

The documentation in this repo is primarily product documentation for InsForge users and agents integrating with InsForge. This skill is for InsForge engineers maintaining that public documentation surface.

## Scope

- `docs/core-concepts/**`
- `docs/agent-docs/**`
- `docs/sdks/**`
- `openapi/**`

## Working Rules

1. Put each document in the correct documentation surface.
   - Human-friendly docs published on the public doc site belong in `docs/core-concepts/` and related public doc folders.
   - For implementation-heavy public docs, prefer an `architecture.md` file inside the relevant `docs/core-concepts/<domain>/` folder.
   - Agent-only instructions belong in `docs/agent-docs/`.
   - SDK integration guides for each framework belong in `docs/sdks/`.
   - OpenAPI contract changes belong in the matching files under `openapi/`.

2. Match the writing style to the audience.
   - Public docs should be human-friendly and explain the implementation clearly.
   - `architecture.md` pages in `docs/core-concepts/` should explain how the feature works in detail.
   - Agent docs in `docs/agent-docs/` should be instruction-first and execution-oriented.
   - Agent docs should avoid explanatory filler and focus on the exact steps an agent should follow to complete the work.

3. Prevent documentation drift on every implementation change.
   - Before changing implementation, check the current user-facing docs for that feature.
   - After changing implementation, update the relevant Markdown docs and the relevant OpenAPI YAML files in the same pass.
   - Do not treat OpenAPI and Markdown as separate optional follow-ups when the feature contract or behavior changed.
   - If a change affects agent workflows, update the corresponding file in `docs/agent-docs/`.
   - If a change affects public product understanding, update the corresponding file in `docs/core-concepts/`, including `architecture.md` when implementation details changed.
   - If a change affects SDK integration guidance, update the corresponding framework guide in `docs/sdks/`.

## Validation

- Re-read every documented command, path, route, and payload for correctness.
- Cross-check OpenAPI YAML and Markdown docs against the implemented behavior before finishing.
- Mention anything you could not verify directly.
