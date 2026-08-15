import { z } from 'zod';

export const serviceStatusEnum = z.enum([
  'creating',
  'deploying',
  'running',
  'stopped',
  'failed',
  'destroying',
]);

/**
 * How a service is reachable.
 *
 *   'none' — internal network only; no host port, no advertised URL.
 *   'port' — published on a host port.
 *   'host' — reachable at a hostname via the operator's gateway.
 *
 * Not every driver can offer every mode — see ComputeCapabilities.ingressModes.
 */
export const ingressModeEnum = z.enum(['none', 'port', 'host']);

// Which driver backs a service. Recorded per row so switching COMPUTE_PROVIDER
// cannot leave the reconcile loop operating on another driver's resources.
export const computeProviderEnum = z.enum(['fly', 'docker']);

// CPU tier accepts Fly.io's standard `<kind>-<N>x` format (e.g. shared-1x,
// performance-8x). No hardcoded allow-list — Fly.io is the source of truth
// for which sizes exist, so adding `performance-32x` (if/when Fly offers it)
// needs zero schema changes here.
//
// This is a *Fly* format and stays the accepted input shape for back-compat,
// but responses also carry a neutral `cpus` count derived from it so a driver
// with no notion of shared-vs-performance tiers has something to map onto.
export const cpuTierRegex = /^(shared|performance)-[1-9]\d*x$/;
export const cpuTierEnum = z
  .string()
  .regex(
    cpuTierRegex,
    'cpu must match `<shared|performance>-<N>x`, e.g. shared-2x or performance-8x'
  );

/**
 * Parse a Fly CPU tier into a neutral core count. Falls back to 1 for malformed
 * input rather than throwing — the provider validates the final spec anyway, and
 * a typo should not crash a response mapper.
 */
export function cpuTierToCores(cpu: string): number {
  const m = /^(?:shared|performance)-([1-9]\d*)x$/.exec(cpu);
  return m ? parseInt(m[1], 10) : 1;
}

export const serviceSchema = z.object({
  id: z.string().uuid(),
  projectId: z.string(),
  name: z.string(),
  imageUrl: z.string(),
  port: z.number(),
  cpu: cpuTierEnum,
  memory: z.number(),
  region: z.string(),
  // Required on the response shape (every persisted row has a value — the
  // migration backfills `'http'` for pre-INS-271 rows). Defaults are only
  // optional on the *input* schemas.
  protocol: z.enum(['http', 'tcp']),
  // Required on the response shape (the migration backfills `true` for
  // pre-existing rows). true = Fly stops the machine when idle and
  // cold-starts it on the next request (the default); false = always-on.
  scaleToZero: z.boolean(),
  /** Neutral core count derived from `cpu`. See cpuTierToCores. */
  cpus: z.number(),
  /** How this service is reachable. Backfilled to 'host' for Fly rows by 064. */
  ingress: ingressModeEnum,
  /** Which driver backs this service. Backfilled to 'fly' by migration 064. */
  provider: computeProviderEnum,
  /** Provider-native app/namespace id — a Fly app name, or a Docker name prefix. */
  providerAppId: z.string().nullable(),
  /** Provider-native instance id — a Fly machine id, or a Docker container id. */
  providerInstanceId: z.string().nullable(),
  /**
   * @deprecated Read-only aliases for providerAppId / providerInstanceId, kept
   * for one minor version so the CLI, dashboard, and MCP server can migrate
   * without a lockstep release. Populated on every response regardless of which
   * driver backs the row — a Docker container id appears here too, which is why
   * these are going away.
   */
  flyAppId: z.string().nullable(),
  flyMachineId: z.string().nullable(),
  status: serviceStatusEnum,
  endpointUrl: z.string().nullable(),
  createdAt: z.string(),
  updatedAt: z.string(),
});

/** What a driver can do. Mirrors ComputeCapabilities on the backend interface. */
export const computeCapabilitiesSchema = z.object({
  scaleToZero: z.boolean(),
  regions: z.boolean(),
  ingressModes: z.array(ingressModeEnum),
  /**
   * Mode applied when a caller omits `ingress`. Always one of `ingressModes`.
   *
   * Reported rather than inferred: for a single-host driver it is an operator
   * setting, so a client that guessed "the first supported mode" would show one
   * thing in its create form and get another from the server.
   *
   * Optional so a backend that predates it does not fail validation; a client with
   * nothing to read falls back to its own choice.
   */
  defaultIngress: ingressModeEnum.optional(),
  sourceBuild: z.enum(['none', 'flyctl', 'context-upload']),
  deployTokenIssuance: z.boolean(),
});

export type ServiceSchema = z.infer<typeof serviceSchema>;
export type ServiceStatus = z.infer<typeof serviceStatusEnum>;
export type CpuTier = z.infer<typeof cpuTierEnum>;
export type ComputeProviderName = z.infer<typeof computeProviderEnum>;
export type IngressMode = z.infer<typeof ingressModeEnum>;
export type ComputeCapabilitiesSchema = z.infer<typeof computeCapabilitiesSchema>;
