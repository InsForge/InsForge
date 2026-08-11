/**
 * Configuration parameters passed to buildInfoPayload.
 */
export interface InfoPayloadParams {
  /** The runtime engine name (e.g. 'deno') */
  runtime?: string;
  /** Dictionary of version metadata key-value pairs */
  version?: Record<string, string>;
  /** Environment string (e.g. 'production' or 'development') */
  env?: string;
}

/**
 * Builds the runtime information payload for the edge functions /info route.
 * Returns safe metadata (runtime, version, environment) with default fallbacks.
 * Topology masking is handled by the caller; this function does not sanitize DB config.
 *
 * @param params - Configuration parameters including runtime, version, and environment
 * @returns Object containing runtime, version, and env metadata
 */
export function buildInfoPayload(params: InfoPayloadParams) {
  return {
    runtime: params.runtime ?? 'deno',
    version: params.version ?? {},
    env: params.env ?? 'production',
  };
}
