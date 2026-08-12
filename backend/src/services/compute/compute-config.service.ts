import type { ComputeConfig, UpdateComputeConfig } from '@insforge/shared-schemas';
import { appConfig } from '@/infra/config/app.config.js';
import { DatabaseManager } from '@/infra/database/database.manager.js';
import { SecretService } from '@/services/secrets/secret.service.js';
import { dockerConfig, setDockerConfigOverrides } from '@/providers/compute/docker.client.js';
import logger from '@/utils/logger.js';

/** Columns of the singleton system.compute_config row, as stored. */
interface StoredSettings {
  default_ingress: string | null;
  public_host: string | null;
  domain: string | null;
  socket_path: string | null;
}

const SETTING_COLUMNS: Record<string, keyof StoredSettings> = {
  defaultIngress: 'default_ingress',
  publicHost: 'public_host',
  domain: 'domain',
  socketPath: 'socket_path',
};

const FLY_API_TOKEN_SECRET = 'FLY_API_TOKEN';
const FLY_ORG_SECRET = 'FLY_ORG';

type SecretStore = Pick<
  SecretService,
  'createSecret' | 'getSecretByKey' | 'listSecrets' | 'updateSecret'
>;

/**
 * Fly credentials, stored rather than baked into the container's environment.
 *
 * Mirrors ModelGatewayConfigService: named secrets in the secret store, with the
 * environment variable as a fallback so an existing deployment keeps working
 * untouched. A stored value wins, because it is the one someone set deliberately
 * through the dashboard.
 *
 * The wrinkle compute has and the model gateway does not: `ComputeProvider.isConfigured()`
 * is synchronous, and so is every Fly request header. Reading the secret store is
 * not. So this service keeps a snapshot that sync callers read, primed at startup and
 * refreshed whenever a credential is written. Nothing awaits on the request path, and
 * a save takes effect without a restart.
 */
export class ComputeConfigService {
  private static instance: ComputeConfigService;

  /**
   * Last known credentials, readable synchronously.
   *
   * `undefined` means "not primed yet" — before the first prime, sync readers fall
   * back to the environment, which is exactly the pre-feature behaviour.
   */
  private snapshot: { apiToken: string | null; org: string | null } | undefined;

  constructor(private readonly secretService: SecretStore = SecretService.getInstance()) {}

  static getInstance(): ComputeConfigService {
    if (!ComputeConfigService.instance) {
      ComputeConfigService.instance = new ComputeConfigService();
    }
    return ComputeConfigService.instance;
  }

  /**
   * Credentials for sync callers: the Fly provider's `isConfigured()` and its request
   * headers. Falls back to the environment when nothing is stored, or when the
   * snapshot has not been primed.
   */
  flyCredentials(): { apiToken: string; org: string } {
    // Falls back through appConfig rather than process.env: appConfig is this
    // codebase's env boundary, and going around it would mean two places that decide
    // what an empty credential is.
    return {
      apiToken: this.snapshot?.apiToken ?? appConfig.fly.apiToken,
      org: this.snapshot?.org ?? appConfig.fly.org,
    };
  }

  /**
   * Load stored credentials into the snapshot.
   *
   * Called at startup and after a write. Never throws: a secret-store outage should
   * leave compute running on whatever the environment provides rather than take the
   * whole feature down.
   */
  /** Load stored settings and push them into the seam every read site goes through. */
  async primeSettings(): Promise<void> {
    try {
      const result = await DatabaseManager.getInstance()
        .getPool()
        .query<StoredSettings>(
          `SELECT default_ingress, public_host, domain, socket_path
             FROM system.compute_config WHERE id = TRUE`
        );
      const row = result.rows[0];
      if (!row) {
        setDockerConfigOverrides({});
        return;
      }
      // Only non-null columns become overrides: null means "fall back to the
      // environment", which is what leaving the key out of the object achieves.
      setDockerConfigOverrides({
        ...(row.default_ingress !== null ? { defaultIngress: row.default_ingress } : {}),
        ...(row.public_host !== null ? { publicHost: row.public_host } : {}),
        ...(row.domain !== null ? { domain: row.domain } : {}),
        ...(row.socket_path !== null ? { socketPath: row.socket_path } : {}),
      });
    } catch (error) {
      // Same reasoning as the credential snapshot: an unreadable config table should
      // leave compute on the environment rather than take the feature down.
      logger.warn('Compute config: could not read stored settings; using the environment', {
        error: error instanceof Error ? error.message : String(error),
      });
      setDockerConfigOverrides({});
    }
  }

  async primeSnapshot(): Promise<void> {
    try {
      const [apiToken, org] = await Promise.all([
        this.secretService.getSecretByKey(FLY_API_TOKEN_SECRET),
        this.secretService.getSecretByKey(FLY_ORG_SECRET),
      ]);
      this.snapshot = { apiToken: normalize(apiToken), org: normalize(org) };
    } catch (error) {
      logger.warn('Compute config: could not read stored Fly credentials; using the environment', {
        error: error instanceof Error ? error.message : String(error),
      });
      this.snapshot = undefined;
    }
  }

  /** What the dashboard shows: whether each credential is set, and where from. */
  async getConfig(): Promise<ComputeConfig> {
    const [storedToken, storedOrg] = await Promise.all([
      this.secretService.getSecretByKey(FLY_API_TOKEN_SECRET),
      this.secretService.getSecretByKey(FLY_ORG_SECRET),
    ]);
    const active = dockerConfig();
    return {
      settings: {
        defaultIngress: active.defaultIngress as ComputeConfig['settings']['defaultIngress'],
        publicHost: active.publicHost,
        domain: active.domain,
        socketPath: active.socketPath,
      },
      flyApiToken: describe(normalize(storedToken), appConfig.fly.apiToken, true),
      // The org is not a secret — showing it in full is more useful than masking a
      // value the operator can read off `fly orgs list` anyway.
      flyOrg: describe(normalize(storedOrg), appConfig.fly.org, false),
    };
  }

  /**
   * Store one or both credentials.
   *
   * Refreshes the snapshot before returning, so the caller can rebuild the provider
   * registry and have a newly-configured Fly become usable immediately.
   */
  async updateConfig(update: UpdateComputeConfig): Promise<void> {
    try {
      await this.applyUpdate(update);
    } finally {
      // Re-read whatever actually landed, including on a partial failure: an earlier
      // write may have succeeded, and a snapshot that still describes the pre-write
      // state is worse than one that matches the store.
      await this.primeSnapshot();
      await this.primeSettings();
    }
  }

  private async applyUpdate(update: UpdateComputeConfig): Promise<void> {
    // One listing for both writes, and it is also what tells create from update:
    // updateSecretByKey is UPDATE-only and reports false rather than inserting, so a
    // first-time save through it would quietly do nothing.
    const existing = new Map(
      (await this.secretService.listSecrets()).map((secret) => [secret.key, secret])
    );
    if (update.flyApiToken !== undefined) {
      await this.upsert(
        FLY_API_TOKEN_SECRET,
        update.flyApiToken,
        existing.get(FLY_API_TOKEN_SECRET)
      );
    }
    if (update.flyOrg !== undefined) {
      await this.upsert(FLY_ORG_SECRET, update.flyOrg, existing.get(FLY_ORG_SECRET));
    }

    // Settings are a separate store — plain values in a config table, not encrypted
    // secrets — so they are written separately and only when present.
    const settingUpdates = Object.entries(SETTING_COLUMNS).filter(
      ([field]) => (update as Record<string, unknown>)[field] !== undefined
    );
    if (settingUpdates.length > 0) {
      const assignments = settingUpdates.map(([, column], i) => `${column} = $${i + 1}`);
      const values = settingUpdates.map(([field]) => {
        const value = (update as Record<string, string | null | undefined>)[field];
        // Empty string is a real setting ("advertise no URL"); null clears back to the
        // environment. Only the latter stores NULL.
        return value ?? null;
      });
      await DatabaseManager.getInstance()
        .getPool()
        .query(
          `UPDATE system.compute_config
              SET ${assignments.join(', ')}, updated_at = NOW()
            WHERE id = TRUE`,
          values
        );
    }
  }

  private async upsert(
    key: string,
    value: string,
    existing: { id: string } | undefined
  ): Promise<void> {
    // Stored in the form the request path wants, so what is in the secret store and
    // what goes on the wire are the same string.
    const stored = normalize(value) ?? value.trim();
    if (existing) {
      const updated = await this.secretService.updateSecret(existing.id, {
        value: stored,
        isActive: true,
        isReserved: true,
      });
      if (!updated) {
        throw new Error(`Failed to update ${key}`);
      }
      return;
    }
    await this.secretService.createSecret({ key, value: stored, isReserved: true });
  }
}

function normalize(value: string | null | undefined): string | null {
  const trimmed = stripFlyScheme(value?.trim());
  return trimmed ? trimmed : null;
}

/**
 * Drop a leading `FlyV1 ` scheme from a pasted token.
 *
 * `fly tokens create org` prints the macaroon with the scheme attached, and the two
 * Fly endpoints this backend calls disagree about who supplies it: the Machines API
 * gets `Bearer <token>` while the logs API gets `FlyV1 <token>` (verified against a
 * live app in the container-logs work — logs reject `Bearer`). Storing the value
 * verbatim would send `FlyV1 FlyV1 fm2_…` to logs and break the panel for anyone who
 * copied the CLI's output as printed, which is the obvious thing to do.
 *
 * A token that never had the prefix is left alone, so this cannot make an older
 * credential worse.
 */
function stripFlyScheme(value: string | undefined): string | undefined {
  return value?.replace(/^FlyV1\s+/i, '');
}

/**
 * Report a credential without returning it.
 *
 * `stored` beats `environment` because that is the precedence `flyCredentials()`
 * applies — the dialog must not claim a value is in use when a stored one overrides it.
 */
function describe(
  stored: string | null,
  fromEnv: string | undefined,
  mask: boolean
): ComputeConfig['flyApiToken'] {
  const envValue = normalize(fromEnv);
  const value = stored ?? envValue;
  if (!value) {
    return { configured: false, masked: null, source: null };
  }
  return {
    configured: true,
    masked: mask ? maskCredential(value) : value,
    source: stored ? 'stored' : 'environment',
  };
}

/** Enough to recognise which token is stored, not enough to use it. */
function maskCredential(value: string): string {
  if (value.length <= 8) {
    return '•'.repeat(value.length);
  }
  return `${value.slice(0, 4)}${'•'.repeat(6)}${value.slice(-4)}`;
}
