export const ANALYTICS_SETUP_PROMPT =
  'I want to add product analytics to this project. Read the current directory and use the InsForge skill to set up PostHog analytics by running `npx @insforge/cli posthog setup`.';

// Self-hosted: the bare command can only hand off an existing connection — it
// cannot create one (the key is the admin's, and must not travel through an
// agent conversation). Tell the agent what to do instead of letting it flail.
export const ANALYTICS_SETUP_PROMPT_SELF_HOSTED =
  'I want to add product analytics to this project. Read the current directory and use the InsForge skill to set up PostHog analytics by running `npx @insforge/cli posthog setup`. If it reports PostHog is not connected, stop and ask me to connect it from the Analytics page of my InsForge dashboard first.';
