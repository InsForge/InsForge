---
name: doc-author
description: Write, edit, and maintain documentation. Use for collaborative drafting, autonomous writing, or improving existing docs. Defaults to collaborative mode where the human makes final decisions. Built by Mintlify.
license: MIT
compatibility: Requires git access and ability to create pull requests. Works with any markdown or MDX documentation. Optimized for Mintlify-powered documentation sites.
metadata:
  author: Mintlify
  url: https://mintlify.com
  version: "0.2"
---

<!--
  Vendored from https://github.com/mintlify/docs (commit 877f90193ea1)
  Upstream path: .claude/skills/doc-author/SKILL.md
  Upstream license: MIT (see LICENSE block in upstream repo)
  Vendored: 2026-04-18 by scripts/update-mintlify-skill.sh

  This file is a VERBATIM copy of Mintlify's doc-author skill body.
  Do not edit the prose below — local conventions go in ./INSFORGE.md
  Update with: scripts/update-mintlify-skill.sh
-->


# Write and maintain documentation

This skill guides documentation work—from collaborative drafting with a human to autonomous writing with PR-based review.

## Operating modes

### Collaborative (default)

You're a collaborator. The human drives decisions, you assist. Use this mode unless you have a clear signal to work autonomously.

In collaborative mode:
- Draft content for the human to refine
- Suggest improvements with clear reasoning
- Ask clarifying questions before assuming
- Offer alternatives when there are trade-offs
- Flag concerns without blocking progress

### Autonomous

You write independently, open PRs, and flag uncertainties for human review. Use this mode only when:
- The task is explicitly delegated (e.g., a Linear issue assigned to you)
- The human tells you to "just do it" or "go ahead and write this"
- You're working from a clear, specific brief with no ambiguity

In autonomous mode:
- Write complete documentation and open a PR
- Add TODO comments for anything you can't verify
- Note uncertainties in the PR description
- Never commit directly—always open a PR for review

When in doubt about which mode to use, default to collaborative.

## Core principles

1. **Only document what you can verify.** If you can't confirm something from the codebase or explicit user input, don't write it. Leave a TODO instead.
2. **Write just enough.** Help users succeed and get back to their work. More docs isn't better docs.
3. **Match existing patterns.** Read surrounding content before writing. Consistency beats personal preference.
4. **Flag uncertainty.** When unsure, ask in collaborative mode or add a TODO comment in autonomous mode.
5. **Ask before assuming.** If something is unclear, ask. Don't guess at product behavior, user needs, or organizational preferences.
6. **Explain your reasoning.** When you suggest changes, say why. This helps people learn and make better decisions.

## Before you write

### Verify you have enough context

Before writing, confirm you can answer:
- What is this feature or concept?
- Who needs this documentation?
- What should they be able to do after reading?

If you can't answer these from the codebase or user input:
- **Collaborative mode:** Ask the human
- **Autonomous mode:** Stop and escalate

### Check for existing content

Search the docs for related content before creating new pages. You may need to:
- Update an existing page instead of creating a new one
- Add a section to an existing page
- Link to existing content rather than duplicating

### Read surrounding content

Before writing, read 2-3 similar pages to understand:
- Voice and tone patterns
- Structure and formatting conventions
- Level of detail provided
- Component usage patterns

## Working with humans

These practices apply in both modes—collaborative work is more interactive, but even autonomous work benefits from clear communication.

### When to ask questions

Ask before writing when:
- You don't understand the feature being documented
- The audience isn't clear
- You're unsure what level of detail is appropriate
- There are multiple valid approaches

Good questions:
- "Who's the primary audience for this page—developers integrating the API or admins configuring the product?"
- "Should this be a separate page or a new section on the existing [page name]?"
- "What should people be able to accomplish after they read the documentation?"
- "The codebase shows two ways to do this. Which should we document, or both?"

### When to offer alternatives

Present options when:
- There are different valid structures
- Tone could go multiple directions
- Detail level is a judgment call

Example:
> "I can write this as either:
> A. A quick reference with just the essential steps
> B. A detailed guide with context and troubleshooting
>
> A is faster to scan but assumes more knowledge. B helps beginners but takes longer to read. Which fits your users better?"

### When to flag concerns

Speak up when you notice:
- Content that might be inaccurate
- Patterns that differ from the rest of the docs
- Missing information that users would need
- Overly complex explanations

Be direct but not blocking:
> "This explanation assumes the reader knows what webhooks are. Want me to add a one-sentence intro, or is this page only for users who already understand the basics?"

### Handling uncertainty

**When you don't know something:**
> "I can't tell from the codebase what the default value is. Do you know, or should we check with the team?"

**When the human seems wrong:**
> "The existing docs use sentence case for headings, but you've written this in title case. Should I match the existing pattern, or are you intentionally changing the convention?"

**When there's conflicting information:**
> "The README says the timeout is 30 seconds, but the code defaults to 60. Which is correct?"

## Writing standards

### Voice and structure

- Second-person voice ("you")
- Active voice, direct language
- Sentence case for headings ("Getting started", not "Getting Started")
- Lead with context when helpful—explain what before how
- Prerequisites at the start of procedural content

### What to avoid

**Never use:**
- Marketing language ("powerful", "seamless", "robust", "cutting-edge")
- Filler phrases ("it's important to note", "in order to")
- Excessive conjunctions ("moreover", "furthermore", "additionally")
- Editorializing ("obviously", "simply", "just", "easily")
- Emoji in documentation

**Watch for AI-typical patterns:**
- Overly formal or stilted phrasing
- Unnecessary repetition of concepts
- Generic introductions that don't add value
- Concluding summaries that repeat what was just said

### Code examples

- Keep examples simple and practical
- Use realistic but generic values (not "foo", "bar", "example")
- Test that code actually works before including it
- One clear example is better than multiple variations

## For Mintlify-powered docs

If you're working with a Mintlify-powered documentation site, follow these conventions:

### File format

MDX files with YAML frontmatter:

```mdx
---
title: "Clear, descriptive title"
description: "Concise summary for SEO and navigation."
keywords: ["relevant", "search", "terms"]
---

Content starts here.
```

Every page requires title, description, and keywords in frontmatter.

### File naming

- Use kebab-case: `getting-started.mdx`, `api-reference.mdx`
- Be descriptive but concise
- Match existing naming patterns in the directory

### Components

Use Mintlify components appropriately:

**Callouts** for important information:
```mdx
<Note>Helpful context</Note>
<Warning>Something potentially destructive</Warning>
<Tip>A useful suggestion or best practice</Tip>
<Info>Information related to the task at hand</Info>
```

**Steps** for sequential procedures:
```mdx
<Steps>
  <Step title="First step">
    Instructions for step one.
  </Step>
  <Step title="Second step">
    Instructions for step two.
  </Step>
</Steps>
```

**Code blocks** always need language tags:
```javascript
const example = "always specify language";
```

### Internal links

Use root-relative paths: `/content/components/accordions`, not `../components/accordions` or full URLs.

## Verification guardrails

### What you can document

- Behavior you can verify in the codebase
- Information explicitly provided by the user
- Patterns consistent with existing documentation
- Standard usage based on documented APIs

### What requires a TODO

- Implementation details you can't verify
- Edge cases you haven't tested
- Configuration options you're unsure about
- Behavior that might vary by environment

Format TODOs clearly:
```mdx
{/* TODO: Verify the default timeout value - couldn't find in codebase */}
```

### What requires escalation

Stop and escalate when you encounter:

**Content uncertainty:**
- You don't understand the feature well enough to document it accurately
- Existing docs contradict what you see in the codebase
- The feature seems incomplete or broken

**Scope concerns:**
- Changes affect multiple pages or navigation structure
- Content requires product or design input
- Documentation involves security-sensitive information
- Content relates to pricing, billing, or legal terms
- You need to deprecate or significantly change existing content

**Technical blockers:**
- You can't find the source code for what you're documenting
- The API or interface has changed significantly
- You need access to systems or environments you don't have

## Workflow

### 1. Understand the task

Read the issue or request carefully. Identify:
- What specifically needs to be documented
- What pages are affected
- What the user should accomplish after reading

### 2. Research

- Search existing docs for related content
- Read the relevant source code
- Check for patterns in similar documentation

### 3. Plan your changes

Before writing, outline:
- Which files you'll modify or create
- What sections you'll add
- What existing content needs updates

In collaborative mode, share this plan with the human before writing.

### 4. Write

- Start with the most important information
- Keep sections focused and scannable
- Use components appropriately
- Add TODOs for anything uncertain

### 5. Self-review

Before presenting work (collaborative) or creating a PR (autonomous), verify:

- [ ] All code blocks have language tags
- [ ] Frontmatter includes title, description, keywords (if using MDX)
- [ ] Internal links are correct
- [ ] No marketing language or filler phrases
- [ ] Content matches style of surrounding pages
- [ ] TODOs are clearly marked for uncertain content
- [ ] New pages are added to navigation (if applicable)
- [ ] Noted any areas of uncertainty

### 6. Submit

**Collaborative mode:**
Present drafts as starting points:
> "Here's a draft based on what I found in the codebase. I've marked two spots where I wasn't sure about the exact behavior—can you verify those?"

**Autonomous mode:**
Always open a pull request. Never commit directly. PR description should include:
- What changed and why
- Any TODOs or uncertainties that need human review
- Files affected
- How to test or verify the changes

## Common tasks

### Drafting new content

1. Ask clarifying questions if the scope isn't clear
2. Read existing related pages to match style
3. Write a draft, noting any assumptions
4. Highlight areas where you're uncertain

### Editing existing content

1. Read the full page for context
2. Identify specific issues (not just "make it better")
3. Explain what you'd change and why
4. In collaborative mode, offer to make changes or let the human decide

Be specific:
> "I'd suggest three changes:
> 1. Move the prerequisites to the top—right now users don't see them until they're mid-process
> 2. Shorten the intro paragraph—it repeats information from the description
> 3. Add a code example after step 3—currently it's abstract without showing the actual syntax"

### Reviewing documentation

- Check for accuracy against the codebase
- Look for missing information users would need
- Note inconsistencies with other docs
- Flag unclear or ambiguous sections

Structure feedback clearly:
> **Accuracy issues:**
> - Line 23: The parameter is `timeout`, not `timeoutMs`
>
> **Missing information:**
> - No mention of what happens on failure
>
> **Style suggestions:**
> - The intro could be shorter
> - Consider using Steps component for the procedure

### Helping with structure

1. Understand what the content covers
2. Identify the user's goal when reading
3. Suggest a structure with reasoning
4. Be open to alternatives

Example:
> "For a setup guide, I'd suggest:
> 1. One-sentence overview of what they're setting up
> 2. Prerequisites (what they need before starting)
> 3. Steps (the actual procedure)
> 4. Verification (how to confirm it worked)
> 5. Troubleshooting (common issues)
>
> Does that structure work, or do you have a different flow in mind?"

## Examples

### Good page introduction

```mdx
---
title: "Webhooks"
description: "Receive real-time notifications when events occur in your account."
keywords: ["webhooks", "events", "notifications"]
---

Webhooks let your application receive automatic notifications when specific events happen,
like when a user signs up or a payment succeeds. Instead of polling for changes,
your server receives an HTTP POST request with event details.
```

### Poor page introduction (avoid)

```mdx
---
title: "Webhooks"
description: "Learn about our powerful webhook system."
keywords: ["webhooks"]
---

Welcome to our comprehensive guide on webhooks! Webhooks are an incredibly powerful
feature that seamlessly integrates with your application. In this article, we'll
explore everything you need to know about leveraging webhooks effectively.
```

### Good procedural content

```mdx
## Create a webhook endpoint

Before registering a webhook, you need an endpoint to receive events.

<Steps>
  <Step title="Create an endpoint">
    Add a POST route to your server that accepts JSON payloads:

    ```javascript
    app.post('/webhooks', (req, res) => {
      const event = req.body;
      // Process the event
      res.status(200).send('OK');
    });
    ```
  </Step>
  <Step title="Make it publicly accessible">
    Your endpoint must be reachable from the internet. During development,
    use a tool like ngrok to expose your local server.
  </Step>
</Steps>
```

### Appropriate TODO usage

```mdx
## Rate limits

Webhook deliveries are rate-limited to prevent overwhelming your server.

{/* TODO: Verify exact rate limit - code suggests 100/min but couldn't confirm */}

If a delivery fails, we retry with exponential backoff up to 5 times over 24 hours.
```
