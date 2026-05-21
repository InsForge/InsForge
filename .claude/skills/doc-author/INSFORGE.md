# InsForge overlay — doc-author conventions

Local overlay for the vendored Mintlify [`doc-author` skill](./SKILL.md).
Upstream prose is authoritative; the items below are InsForge-specific and
override upstream advice only where they conflict.

## Frontmatter: `title` + `description` only

InsForge `docs/*.mdx` uses **only** `title` and `description` in YAML
frontmatter. Do not add `icon`, `sidebarTitle`, or other Mintlify-supported
keys unless a neighbouring page already does.

- `docs/quickstart.mdx:1-4` — canonical example
- `docs/sdks/typescript/auth.mdx:1-4` — SDK-reference style

## No `<ParamField>` — bullet lists for parameters

The repo has zero `<ParamField>` usage. Document parameters as plain markdown
bullet lists under a `### Parameters` heading.

- `docs/sdks/typescript/auth.mdx:17-22` — canonical pattern

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

## Voice: second-person imperative

Address the reader as "you"; use imperative verbs. See `docs/quickstart.mdx`
for the canonical voice.

## Sound human, not AI-generated

InsForge docs are public-facing; they should not read as machine-written. Strip
the common AI tells (from the humanizer skill, based on Wikipedia's "Signs of AI
writing"):

- **Em dashes** for asides or emphasis. Use a comma, period, colon, or parentheses instead.
- **Rule of three.** Don't auto-triple ("fast, reliable, and scalable"); name the one that matters.
- **Negative parallelism** ("It's not just X, it's Y"). State the positive claim directly.
- **Inflated significance** ("plays a vital role", "underscores the importance of").
- **Vague attribution** ("studies show", "widely regarded"). Name the source or drop the claim.
- **AI vocabulary**: delve, leverage, utilize, underscore, foster, realm, landscape, tapestry, seamless, robust, pivotal. Use the plain word.

Read it back. If it sounds like a press release or a term paper, flatten it.

When you're not sure the draft is clean, run the full `humanizer` skill for a deeper pass (or see [blader/humanizer](https://github.com/blader/humanizer)). The rules above are the quick version.
