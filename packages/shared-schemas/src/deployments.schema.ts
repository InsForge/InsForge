import { z } from 'zod';

/** Which driver hosts a site. Persisted per row in `deployments.runs.provider`. */
export const sitesProviderEnum = z.enum(['vercel', 'docker']);

/**
 * How a site is reachable. The compute ingress vocabulary minus `none`: a site nobody
 * can reach is not a deployment. Kept in the same words on purpose, so one gateway
 * config covers compute services and sites together.
 */
export const sitesIngressModeEnum = z.enum(['port', 'host']);

/**
 * What the active sites driver can do.
 *
 * Reported rather than inferred: a client that guessed from the provider name would
 * offer buttons the driver has no implementation for. Every field is something two
 * drivers genuinely differ on.
 */
export const sitesCapabilitiesSchema = z.object({
  /**
   * `runtime` — the platform holds env vars for the deployed app and can list, read and
   * delete them, and a running server sees them in `process.env`. `build-only` — values
   * reach the build and are baked into the artifact, so there is nothing to read back.
   * `none` — unsupported.
   */
  envVars: z.enum(['runtime', 'build-only', 'none']),
  /** The driver attaches and verifies domains itself, rather than the operator routing one. */
  customDomains: z.boolean(),
  /** The site gets a name under a shared domain the driver owns. */
  slug: z.boolean(),
  /** A previous deployment can be made live again without rebuilding it. */
  rollback: z.boolean(),
  /** Build output is retrievable after the fact. */
  buildLogs: z.boolean(),
  /** The driver infers how to build from the source tree. */
  frameworkDetection: z.boolean(),
  // At least one: a driver offering no reachable mode would advertise a deployment
  // nobody can open.
  ingressModes: z.array(sitesIngressModeEnum).min(1),
  /** Applied when a caller names no mode. Always one of `ingressModes`. */
  defaultIngress: sitesIngressModeEnum.optional(),
});

export type SitesProviderName = z.infer<typeof sitesProviderEnum>;
export type SitesIngressMode = z.infer<typeof sitesIngressModeEnum>;
export type SitesCapabilitiesSchema = z.infer<typeof sitesCapabilitiesSchema>;

/**
 * Same fields, plus the cross-field rule: a default the driver does not support would
 * point every client at an ingress mode it cannot serve. Kept separate from the base
 * object so the object stays extensible with `.extend()`.
 */
export const sitesCapabilitiesResponseSchema = sitesCapabilitiesSchema.refine(
  (caps) => !caps.defaultIngress || caps.ingressModes.includes(caps.defaultIngress),
  { message: 'defaultIngress must be one of ingressModes', path: ['defaultIngress'] }
);

/**
 * Deployment status enum schema
 * WAITING -> UPLOADING -> (Vercel statuses: QUEUED/BUILDING/READY/ERROR/CANCELED)
 */
export const deploymentStatusSchema = z.enum([
  'WAITING', // Record created, waiting for source zip upload or direct file registration/content
  'UPLOADING', // File uploads or Vercel deployment creation are in progress
  'QUEUED', // Vercel: deployment queued
  'BUILDING', // Vercel: deployment building
  'READY', // Vercel: deployment ready
  'ERROR', // Vercel: deployment failed
  'CANCELED', // Vercel: deployment canceled
]);

export type DeploymentStatusType = z.infer<typeof deploymentStatusSchema>;

export const deploymentSchema = z.object({
  id: z.string().uuid(),
  providerDeploymentId: z.string().nullable(), // Provider's deployment ID, null until deployment starts
  provider: z.string(),
  status: deploymentStatusSchema,
  url: z.string().nullable(),
  metadata: z.record(z.unknown()).nullable(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});

export type DeploymentSchema = z.infer<typeof deploymentSchema>;
