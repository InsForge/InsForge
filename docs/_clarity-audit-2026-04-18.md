# Dogfood clarity audit — 2026-04-18

Issue: #1123  
Date: 2026-04-18  
Scope: Walk through the docs as a new user or coding agent starting from `docs/introduction.mdx`.

This audit builds on the previous mechanical audit in `docs/_audit-2026-04-18.md`. The previous audit already covered:

- Broken navigation entries
- Broken internal links
- Flutter SDK navigation discoverability
- Experimental callout type mismatches
- Basic overlay-rule violations, such as emoji bullets

This audit does not repeat that scan. It only records those issues if they still block the user journey after the previous fixes. The focus is on clarity, sequencing, implicit prerequisites, and whether a new user can continue from one step to the next.

## Traversal order

1. `docs/introduction.mdx`
2. `docs/mcp-setup.mdx`

## Findings by page

### `docs/introduction.mdx`

#### User goal

A first-time reader should understand, within a few minutes, what InsForge is, what problems it solves, how MCP fits into the development workflow, how SDKs fit into the application runtime, and which page to read next.

#### Gaps

- Finding: The page introduces InsForge quickly, but it does not give the reader a complete first-run mental model.
- Evidence: The current page is organized around “Why InsForge,” “Next Steps,” and “Features.” It does not clearly explain how the dashboard, MCP server, SDKs, backend resources, and application runtime fit together.
- Reader impact: A new user may understand that InsForge provides backend features, but may not understand how to start using those features in an agent-assisted development workflow.
- Suggested fix: Add a concise overview that explains what InsForge is, when it is useful, how MCP and SDKs serve different parts of the workflow, and which path the reader should follow next.

### `docs/mcp-setup.mdx`

#### User goal

A reader should be able to configure the InsForge MCP server for their coding agent and verify that the agent can call InsForge MCP tools.

#### Implicit prerequisites

- Finding: The verification step assumes that the InsForge MCP server is already visible to the coding agent, but this prerequisite is not explicit enough for first-time MCP users.
- Evidence: After running the installer command, a first-time Codex user may still reach the verification prompt without seeing the InsForge MCP server in the agent’s MCP configuration. In that state, asking the agent to call `fetch-docs` fails because the tool is not available to the agent.
- Reader impact: The user cannot complete MCP verification and may not know whether the issue is caused by installation, agent configuration, authentication, or transport selection.
- Suggested fix: Add a clearer prerequisite or setup note that tells users to confirm the InsForge MCP server is visible in their coding agent before running the verification prompt. For Codex in VS Code, include a short note that users may need to add the remote MCP server in the agent’s MCP settings and then authenticate it before `fetch-docs` is available.

## Prioritized fixes

### P0 / high impact

1. `docs/introduction.mdx` — Needs a clearer first-run overview that explains the InsForge workflow and routes readers to the right next step.

### P1 / medium impact

1. `docs/mcp-setup.mdx` — Make the MCP visibility and authentication prerequisites clearer before the verification step.

### P2 / low impact

No low-priority findings selected for this PR.

## Pages selected for rewrite

1. `docs/introduction.mdx`

## Deferred findings

The `docs/mcp-setup.mdx` prerequisite issue is recorded here but is not fixed in this PR. Consider moving it to #1121 or addressing it in a follow-up PR.