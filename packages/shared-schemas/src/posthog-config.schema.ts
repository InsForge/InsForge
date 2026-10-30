import { z } from 'zod';

// Self-hosted PostHog connection config. Cloud projects get their connection
// through OAuth on cloud-backend; self-hosting stores a developer-supplied
// personal API key locally. Mirrors the Apify config schema shape.

export const posthogCredentialStatusSchema = z.object({
  configured: z.boolean(),
  maskedKey: z.string().nullable(),
});

export const posthogConfigSchema = z.object({
  personalApiKey: posthogCredentialStatusSchema,
  host: z.string().url().nullable(),
  posthogProjectId: z.string().nullable(),
  projectName: z.string().nullable(),
  organizationName: z.string().nullable(),
});

// `region` rather than a free-form host: v1 supports PostHog Cloud US/EU only.
// The stored value is a plain host string, so allowing a custom host later is a
// schema change here plus an SSRF guard — no storage migration.
export const posthogRegionSchema = z.enum(['US', 'EU']);

export const updatePosthogConfigSchema = z.object({
  personalApiKey: z.string().trim().min(1).max(512),
  region: posthogRegionSchema.default('US'),
  // Optional: pick a specific PostHog project when the key can see several.
  // Omitted means "auto-select if the key sees exactly one".
  posthogProjectId: z.string().trim().min(1).max(64).optional(),
});

export const posthogDiscoveredProjectSchema = z.object({
  posthogProjectId: z.string(),
  name: z.string(),
  organizationName: z.string().nullable(),
});

export type PosthogCredentialStatus = z.infer<typeof posthogCredentialStatusSchema>;
export type PosthogConfig = z.infer<typeof posthogConfigSchema>;
export type PosthogRegion = z.infer<typeof posthogRegionSchema>;
export type UpdatePosthogConfig = z.infer<typeof updatePosthogConfigSchema>;
export type PosthogDiscoveredProject = z.infer<typeof posthogDiscoveredProjectSchema>;
