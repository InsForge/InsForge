import type { ComputeConfig, UpdateComputeConfig } from '@insforge/shared-schemas';
import { appConfig } from '@/infra/config/app.config.js';
import { SecretService } from '@/services/secrets/secret.service.js';
import logger from '@/utils/logger.js';

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

  /**
   * Bumped before each read so a slow prime cannot overwrite a newer one.
   *
   * Two saves can overlap — each re-primes in its `finally` — and without this the
   * one that started first could land last and put the pre-rotation credentials back.
   * Same guard ModelGatewayConfigService uses for the same reason.
   */
  private snapshotEpoch = 0;

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
      // normalize() on the environment too: the CLI prints the macaroon with its
      // scheme, and pasting that into `.env` is as likely as pasting it into the
      // dashboard. Only stripping stored values fixed half the problem.
      apiToken: this.snapshot?.apiToken ?? normalize(appConfig.fly.apiToken) ?? '',
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
  async primeSnapshot(): Promise<void> {
    const epoch = ++this.snapshotEpoch;
    try {
      const [apiToken, org] = await Promise.all([
        this.secretService.getSecretByKey(FLY_API_TOKEN_SECRET),
        this.secretService.getSecretByKey(FLY_ORG_SECRET),
      ]);
      if (epoch !== this.snapshotEpoch) {
        // A later prime already ran; its read is the fresher one.
        return;
      }
      this.snapshot = { apiToken: normalize(apiToken), org: normalize(org) };
    } catch (error) {
      logger.warn('Compute config: could not read stored Fly credentials; using the environment', {
        error: error instanceof Error ? error.message : String(error),
      });
      // Same epoch check as the success path: a read that failed must not discard a
      // newer one that succeeded, or a rotation would silently fall back to the
      // environment.
      if (epoch === this.snapshotEpoch) {
        this.snapshot = undefined;
      }
    }
  }

  /** What the dashboard shows: whether each credential is set, and where from. */
  async getConfig(): Promise<ComputeConfig> {
    const [storedToken, storedOrg] = await Promise.all([
      this.secretService.getSecretByKey(FLY_API_TOKEN_SECRET),
      this.secretService.getSecretByKey(FLY_ORG_SECRET),
    ]);
    return {
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
      // Re-read whatever actually landed, including on a partial failure: the token
      // may have been written before the org failed, and a snapshot that still
      // describes the pre-write state is worse than one that matches the store.
      await this.primeSnapshot();
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
