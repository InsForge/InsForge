import { dockerConfig } from '@/providers/compute/docker.client.js';
import { DockerSitesProvider } from '@/providers/deployments/docker.provider.js';
import { VercelProvider } from '@/providers/deployments/vercel.provider.js';
import { isCloudEnvironment } from '@/utils/environment.js';
import type {
  DomainStore,
  EnvVarStore,
  SitesProvider,
  SitesProviderName,
} from '@/providers/deployments/sites.provider.js';
import { AppError } from '@/utils/errors.js';
import { ERROR_CODES, type SitesMetadataSchema } from '@insforge/shared-schemas';

export interface SitesRegistry {
  providers: Map<SitesProviderName, SitesProvider>;
  defaultProvider: SitesProviderName;
}

/**
 * Build the registry from the environment.
 *
 * `SITES_PROVIDER` names the default for **new** deployments, and `off` disables sites
 * entirely. It is not a restriction: `deployments.runs.provider` records which driver
 * made each row, and naming a default must not strand rows that belong to another one.
 *
 * Mirrors `buildComputeRegistry()` deliberately, including the two behaviours that
 * matter more than the shape: an explicitly requested driver that is not usable throws
 * here rather than 500-ing on the first deploy, and a driver registers on
 * `isConfigured()` alone, never on having been requested.
 */
export function buildSitesRegistry(): SitesRegistry {
  const requested = (process.env.SITES_PROVIDER || '').trim().toLowerCase();

  if (requested === 'off') {
    throw new AppError(
      'Sites are disabled (SITES_PROVIDER=off).',
      503,
      ERROR_CODES.DEPLOYMENT_NOT_CONFIGURED,
      'Unset SITES_PROVIDER or set it to a provider name, then restart the container.'
    );
  }
  const known = ['', 'auto', 'vercel', 'docker'];
  if (!known.includes(requested)) {
    throw new AppError(
      `Unknown SITES_PROVIDER "${requested}". Expected one of: vercel, docker, off.`,
      503,
      ERROR_CODES.DEPLOYMENT_NOT_CONFIGURED
    );
  }

  const providers = new Map<SitesProviderName, SitesProvider>();
  const vercel = VercelProvider.getInstance();

  if (requested === 'vercel' && !vercel.isConfigured()) {
    throw new AppError(
      'SITES_PROVIDER=vercel but no Vercel credentials are available.',
      503,
      ERROR_CODES.DEPLOYMENT_NOT_CONFIGURED,
      'Set VERCEL_TOKEN, VERCEL_TEAM_ID and VERCEL_PROJECT_ID, then restart the container.'
    );
  }
  if (vercel.isConfigured()) {
    providers.set('vercel', vercel);
  }

  // Docker registers itself when the socket is present — mounting it into the InsForge
  // container *is* the operator's opt-in, the same contract as the compute driver. It
  // registers on isConfigured() alone, never on having been requested, so a named driver
  // that cannot run produces the explicit error below rather than obscure later failures.
  const docker = DockerSitesProvider.getInstance();
  if (docker.isConfigured()) {
    providers.set('docker', docker);
  } else if (requested === 'docker') {
    // Two different reasons, and conflating them would send an operator chasing a socket
    // mount that is not the problem. isConfigured() fails closed on our infrastructure
    // whether or not a socket exists — see the driver for why hosting customer containers
    // on shared hosts is a tenant escape.
    if (isCloudEnvironment()) {
      throw new AppError(
        'The Docker sites driver is self-host only and cannot run on a cloud-managed project.',
        400,
        ERROR_CODES.DEPLOYMENT_NOT_CONFIGURED,
        'Unset SITES_PROVIDER to use the managed provider.'
      );
    }
    throw new AppError(
      `SITES_PROVIDER=docker but no Docker socket at ${dockerConfig().socketPath}.`,
      503,
      ERROR_CODES.DEPLOYMENT_NOT_CONFIGURED,
      'Mount the Docker socket into the InsForge container (or set DOCKER_SOCKET_PATH), then restart.'
    );
  }

  if (providers.size === 0) {
    throw new AppError(
      'No sites provider is configured.',
      503,
      ERROR_CODES.DEPLOYMENT_NOT_CONFIGURED,
      'Set VERCEL_TOKEN, VERCEL_TEAM_ID and VERCEL_PROJECT_ID, or mount the Docker socket, then restart.'
    );
  }

  // Vercel wins when both are available and nothing was named: an existing self-host that
  // mounts the socket for compute must not silently move its site to a new driver on
  // upgrade. Docker becomes the default only when it is the only one, or when asked for.
  const fallback = providers.has('vercel') ? 'vercel' : [...providers.keys()][0];
  const named = requested as SitesProviderName;
  const defaultProvider =
    requested && requested !== 'auto' && providers.has(named) ? named : fallback;

  return { providers, defaultProvider };
}

/**
 * The driver new deployments go to.
 *
 * Resolved per call rather than held on the service: credentials can be stored through
 * the dashboard, and a registry captured at construction would predate them.
 */
export function selectSitesProvider(): SitesProvider {
  const registry = buildSitesRegistry();
  const provider = registry.providers.get(registry.defaultProvider);
  if (!provider) {
    // Unreachable: buildSitesRegistry throws on an empty map and picks the default out
    // of its own keys. Checked rather than asserted so a future driver that registers
    // conditionally cannot turn this into a confusing undefined.
    throw new AppError(
      'No sites provider is configured.',
      503,
      ERROR_CODES.DEPLOYMENT_NOT_CONFIGURED
    );
  }
  return provider;
}

/**
 * A capability the active driver does not have is a 400, not a 500: nothing is broken,
 * the request asked for something this deployment cannot do. The driver is named because
 * an operator who switched SITES_PROVIDER needs to know which one answered.
 */
export function unsupportedFeature(providerName: SitesProviderName, feature: string): AppError {
  return new AppError(
    `The ${providerName} sites driver does not support ${feature}.`,
    400,
    // Not DEPLOYMENT_NOT_CONFIGURED: that means "set this up" and comes back as a 503.
    // This is "this driver will never do it", and collapsing the two would undo the
    // reason that code was added.
    ERROR_CODES.DEPLOYMENT_FEATURE_UNSUPPORTED
  );
}

export function requireEnvVarStore(): EnvVarStore {
  const provider = selectSitesProvider();
  if (!provider.envVars) {
    throw unsupportedFeature(provider.name, 'environment variables');
  }
  return provider.envVars;
}

export function requireDomainStore(): DomainStore {
  const provider = selectSitesProvider();
  if (!provider.domains) {
    throw unsupportedFeature(provider.name, 'custom domains');
  }
  return provider.domains;
}

/** Whether any driver can serve a deployment here. Never throws. */
export function isAnySitesProviderConfigured(): boolean {
  try {
    buildSitesRegistry();
    return true;
  } catch {
    return false;
  }
}

/**
 * The `sites` slice of the admin metadata response, or undefined when sites are
 * unavailable — presence is the coarse "can this backend host a site" signal.
 *
 * A free function for the same reason `getComputeMetadata()` is: metadata aggregation
 * must not fail because an optional feature is off, and nothing here touches the
 * database.
 */
export function getSitesMetadata(): SitesMetadataSchema | undefined {
  let registry: SitesRegistry;
  try {
    registry = buildSitesRegistry();
  } catch {
    // Not configured, disabled, or misconfigured. All three mean the same thing to a
    // caller deciding whether to offer sites at all.
    return undefined;
  }

  const providers: SitesMetadataSchema['providers'] = {};
  for (const [name, provider] of registry.providers) {
    providers[name] = provider.capabilities();
  }
  return { defaultProvider: registry.defaultProvider, providers };
}
