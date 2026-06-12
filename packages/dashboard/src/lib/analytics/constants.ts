/**
 * Catalog of analytics event names and feature flag keys.
 *
 * Always reference these constants instead of inline string literals so the
 * full tracking surface stays auditable in one place and typos can't silently
 * create new events.
 */
export const ANALYTICS_EVENTS = {
  ONBOARDING_ACTION_TAKEN: 'onboarding_action_taken',
  ONBOARDING_COMPLETED: 'onboarding_completed',
} as const;

export const FEATURE_FLAGS = {
  DASHBOARD_V4_EXPERIMENT: 'dashboard-v4-experiment',
  ONBOARDING_METHOD_EXPERIMENT: 'onboarding-method-experiment',
  MCP_VS_CLI: 'mcp-vs-cli',
} as const;

/** Expected variant values returned by the feature flags above. */
export const FEATURE_FLAG_VARIANTS = {
  D_TEST: 'd_test',
} as const;
