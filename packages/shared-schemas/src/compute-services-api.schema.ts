import { z } from 'zod';
import {
  serviceSchema,
  cpuTierEnum,
  ingressModeEnum,
  computeProviderEnum,
} from './compute-services.schema.js';

const envVarKeyRegex = /^[A-Z_][A-Z0-9_]*$/;

export const createServiceSchema = z.object({
  /**
   * Which driver to create on. Omitted, the server uses its default — which is what
   * the CLI does and what every caller did before providers could coexist.
   *
   * The dashboard sends it because provider is its navigation axis: creating from
   * Fly's page must not put the service on Docker, where that page would then filter
   * it out of its own list.
   */
  provider: computeProviderEnum.optional(),
  name: z
    .string()
    .min(1)
    .max(63)
    .regex(/^[a-z0-9]([a-z0-9-]*[a-z0-9])?$/, {
      message:
        'Name must be DNS-safe: lowercase letters, numbers, and dashes only, must start with a letter or number',
    }),
  /**
   * Image URL — image-mode (any registry) or source-mode (digest-pinned
   * registry.fly.io ref produced by the CLI's `flyctl deploy --build-only --push`).
   * The CLI is responsible for building/pushing in source mode; the cloud
   * just launches a machine pointing at the resulting image.
   *
   * Required for createService (image-mode immediate launch).
   * Omit for prepareForDeploy / source-mode (the route's own validation handles it).
   */
  imageUrl: z.string().min(1).optional(),
  port: z.number().min(1).max(65535),
  cpu: cpuTierEnum.default('shared-1x'),
  memory: z.coerce
    .number()
    .refine((v) => [256, 512, 1024, 2048, 4096, 8192].includes(v), {
      message: 'Memory must be one of: 256, 512, 1024, 2048, 4096, 8192',
    })
    .default(512),
  envVars: z
    .record(
      z.string().regex(envVarKeyRegex, { message: 'Env var keys must match [A-Z_][A-Z0-9_]*' }),
      z.string().max(4096)
    )
    .optional(),
  region: z.string().default('iad'),
  /**
   * Edge protocol. `'http'` (default) is the existing behaviour — Fly terminates
   * TLS at its anycast edge and proxies HTTP/1.1 + HTTP/2 to the container on
   * the container's port. `'tcp'` is for raw TCP services (Redis, the Postgres
   * wire protocol, custom binary protocols) — Fly exposes the container's port
   * directly with empty L7 handlers so bytes flow end-to-end without HTTP
   * inspection. Optional and back-compat: omitting the field is identical to
   * sending `'http'` at every fallback site downstream.
   */
  protocol: z.enum(['http', 'tcp']).optional(),
  /**
   * How the service should be reachable. Omitted, the server picks the active
   * driver's default (see ComputeCapabilities.ingressModes) — which for a
   * single-host driver is `none`, since most compute takes no inbound traffic.
   * A driver that cannot honour the requested mode coerces it and logs the
   * substitution rather than failing an otherwise valid deploy.
   */
  ingress: ingressModeEnum.optional(),
  /**
   * Scale-to-zero. `true` (default) is the existing behaviour — Fly stops the
   * machine when idle and cold-starts it on the next request. `false` keeps
   * the machine running 24/7 (Fly autostop 'off', one machine always warm)
   * for services that can't tolerate cold-start latency. Optional and
   * back-compat: omitting the field is identical to sending `true`.
   */
  scaleToZero: z.boolean().optional(),
});

export const updateServiceSchema = z
  .object({
    /**
     * New image URL — image-mode (any registry) or source-mode digest-pinned
     * registry.fly.io ref. For non-image updates (port-only, env-only) omit.
     */
    imageUrl: z.string().min(1).optional(),
    port: z.number().min(1).max(65535).optional(),
    cpu: cpuTierEnum.optional(),
    memory: z.coerce
      .number()
      .refine((v) => [256, 512, 1024, 2048, 4096, 8192].includes(v), {
        message: 'Memory must be one of: 256, 512, 1024, 2048, 4096, 8192',
      })
      .optional(),
    /**
     * Wholesale replacement of the env var map. Sending {} clears all env
     * vars. For partial edits (rotate one secret without restating the
     * other six), use envVarsPatch instead.
     */
    envVars: z
      .record(
        z.string().regex(envVarKeyRegex, { message: 'Env var keys must match [A-Z_][A-Z0-9_]*' }),
        z.string().max(4096)
      )
      .optional(),
    /**
     * Partial env edit. `set` upserts keys, `unset` removes them. The server
     * decrypts the existing env_vars blob, applies the patch, and re-encrypts.
     * Mutually exclusive with `envVars` (the wholesale path) — sending both
     * is rejected, since the intent would be ambiguous.
     */
    envVarsPatch: z
      .object({
        set: z
          .record(
            z.string().regex(envVarKeyRegex, {
              message: 'Env var keys must match [A-Z_][A-Z0-9_]*',
            }),
            z.string().max(4096)
          )
          .optional(),
        unset: z
          .array(
            z.string().regex(envVarKeyRegex, {
              message: 'Env var keys must match [A-Z_][A-Z0-9_]*',
            })
          )
          .optional(),
      })
      .refine((p) => (p.set && Object.keys(p.set).length > 0) || (p.unset && p.unset.length > 0), {
        message: 'envVarsPatch must specify at least one key in set or unset',
      })
      .optional(),
    region: z.string().optional(),
    /** Ingress — same semantics as createServiceSchema.ingress. */
    ingress: ingressModeEnum.optional(),
    /**
     * Edge protocol — same semantics as createServiceSchema.protocol. Optional
     * on update; omitting it leaves the existing service's protocol in place.
     */
    protocol: z.enum(['http', 'tcp']).optional(),
    /**
     * Scale-to-zero — same semantics as createServiceSchema.scaleToZero.
     * Optional on update; omitting it leaves the existing setting in place.
     */
    scaleToZero: z.boolean().optional(),
  })
  .refine((data) => !(data.envVars !== undefined && data.envVarsPatch !== undefined), {
    message:
      'envVars and envVarsPatch are mutually exclusive — pick one (envVars replaces wholesale, envVarsPatch merges)',
    path: ['envVarsPatch'],
  });

export const listServicesResponseSchema = z.object({
  services: z.array(serviceSchema),
});

// A single container stdout/stderr line, as surfaced from Fly's logs API.
// `timestamp` is normalized to epoch milliseconds by the backend provider.
export const computeLogLineSchema = z.object({
  timestamp: z.number(),
  message: z.string(),
  instance: z.string().optional(),
  region: z.string().optional(),
});

// Response for GET /compute/services/:id/logs. `nextToken` is an opaque cursor
// (Fly's nanosecond `next_token`) to poll forward for live tailing; null when
// there is nothing further to page.
export const computeLogsResponseSchema = z.object({
  lines: z.array(computeLogLineSchema),
  nextToken: z.string().nullable(),
});

export type CreateServiceRequest = z.infer<typeof createServiceSchema>;
export type UpdateServiceRequest = z.infer<typeof updateServiceSchema>;

/**
 * What a *caller* sends, as opposed to what the server has after parsing.
 *
 * Fields with a `.default()` — `region`, `cpu`, `memory` — are required on the
 * inferred output type but optional on the wire. A client that deliberately omits
 * one (the dashboard drops `region` when the provider has no regions, so the
 * stored row does not claim a choice the user never made) needs this shape.
 */
export type CreateServiceRequestInput = z.input<typeof createServiceSchema>;
export type ListServicesResponse = z.infer<typeof listServicesResponseSchema>;
export type ComputeLogLine = z.infer<typeof computeLogLineSchema>;
export type ComputeLogsResponse = z.infer<typeof computeLogsResponseSchema>;

/**
 * Whether a credential is set, and a masked hint of it — never the value.
 *
 * Same shape as modelGatewayCredentialStatusSchema, for the same reason: the dialog
 * needs to say "configured" and show enough to recognise which key is stored, and
 * nothing should hand a Fly token back over the wire once it is saved.
 */
export const computeCredentialStatusSchema = z.object({
  configured: z.boolean(),
  masked: z.string().nullable(),
  /**
   * Where the value came from. `environment` means it is in the container's env and
   * this dialog cannot change it; saving here stores one that takes precedence.
   */
  source: z.enum(['stored', 'environment']).nullable(),
});

export const computeConfigSchema = z.object({
  flyApiToken: computeCredentialStatusSchema,
  flyOrg: computeCredentialStatusSchema,
});

/** At least one credential, so an empty body cannot look like a successful no-op. */
export const updateComputeConfigSchema = z
  .object({
    flyApiToken: z.string().trim().min(1).max(512).optional(),
    flyOrg: z.string().trim().min(1).max(128).optional(),
  })
  .refine((value) => Object.keys(value).length > 0, {
    message: 'At least one field is required',
  });

export type ComputeCredentialStatus = z.infer<typeof computeCredentialStatusSchema>;
export type ComputeConfig = z.infer<typeof computeConfigSchema>;
export type UpdateComputeConfig = z.infer<typeof updateComputeConfigSchema>;
