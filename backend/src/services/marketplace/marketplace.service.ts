import net from 'net';
import dns from 'dns/promises';
import {
  ERROR_CODES,
  type MarketplacePlugin,
  type MarketplacePluginWithStatus,
} from '@insforge/shared-schemas';
import { SecretService } from '@/services/secrets/secret.service.js';
import { isPrivateIp } from '@/services/email/smtp-config.service.js';
import { AppError } from '@/utils/errors.js';
import { MarketplaceCatalogService } from './catalog.service.js';

const VALIDATION_TIMEOUT_MS = 10_000;

/**
 * Generic install engine for marketplace plugins. Installs are declarative
 * and secret-only: the catalog entry names the secret and (optionally) a
 * provider endpoint to validate the key against; installing stores the key
 * encrypted in system.secrets, where it is auto-injected into edge-function
 * environments on redeploy. Installed = an active secret with that name.
 */
export class MarketplaceService {
  private static instance: MarketplaceService;
  private catalogService = MarketplaceCatalogService.getInstance();
  private secretService = SecretService.getInstance();

  static getInstance(): MarketplaceService {
    if (!MarketplaceService.instance) {
      MarketplaceService.instance = new MarketplaceService();
    }
    return MarketplaceService.instance;
  }

  async listPlugins(): Promise<MarketplacePluginWithStatus[]> {
    const [catalog, secrets] = await Promise.all([
      this.catalogService.getCatalog(),
      this.secretService.listSecrets(),
    ]);
    const activeKeys = new Set(secrets.filter((s) => s.isActive).map((s) => s.key));
    return catalog.plugins.map((plugin) => ({
      ...plugin,
      installed: activeKeys.has(plugin.install.secretName),
    }));
  }

  async installPlugin(slug: string, apiKey: string): Promise<MarketplacePlugin> {
    const plugin = await this.getPlugin(slug);

    if (plugin.install.validation) {
      await this.validateApiKey(plugin, apiKey);
    }

    const secretName = plugin.install.secretName;
    const secrets = await this.secretService.listSecrets();
    // An existing non-reserved secret (active or not) is updated in place:
    // API-level installs deliberately act as "set/replace the key". The
    // dashboard offers uninstall instead when a plugin is already installed.
    const existing = secrets.find((s) => s.key === secretName);

    if (existing?.isReserved) {
      throw new AppError(
        `Secret ${secretName} is reserved and managed by the platform`,
        403,
        ERROR_CODES.FORBIDDEN
      );
    }

    if (existing) {
      const success = await this.secretService.updateSecret(existing.id, {
        value: apiKey,
        isActive: true,
      });
      if (!success) {
        throw new AppError(
          `Failed to store secret: ${secretName}`,
          500,
          ERROR_CODES.INTERNAL_ERROR
        );
      }
    } else {
      await this.secretService.createSecret({ key: secretName, value: apiKey });
    }

    return plugin;
  }

  async uninstallPlugin(slug: string): Promise<MarketplacePlugin> {
    const plugin = await this.getPlugin(slug);
    const secretName = plugin.install.secretName;
    const secrets = await this.secretService.listSecrets();
    const existing = secrets.find((s) => s.key === secretName && s.isActive);

    if (!existing) {
      throw new AppError(`Plugin is not installed: ${slug}`, 404, ERROR_CODES.NOT_FOUND);
    }
    if (existing.isReserved) {
      throw new AppError(
        `Secret ${secretName} is reserved and managed by the platform`,
        403,
        ERROR_CODES.FORBIDDEN
      );
    }

    const success = await this.secretService.updateSecret(existing.id, { isActive: false });
    if (!success) {
      throw new AppError(`Failed to remove secret: ${secretName}`, 500, ERROR_CODES.INTERNAL_ERROR);
    }

    return plugin;
  }

  private async getPlugin(slug: string): Promise<MarketplacePlugin> {
    const catalog = await this.catalogService.getCatalog();
    const plugin = catalog.plugins.find((p) => p.slug === slug);
    if (!plugin) {
      throw new AppError(`Unknown marketplace plugin: ${slug}`, 404, ERROR_CODES.NOT_FOUND);
    }
    return plugin;
  }

  /**
   * Prove the key works by calling the provider endpoint from the catalog
   * entry. The catalog is our own hosted file, but its URL is still treated
   * as untrusted input: https-only (schema-enforced), must not resolve to a
   * private address, redirects rejected, response body discarded.
   */
  private async validateApiKey(plugin: MarketplacePlugin, apiKey: string): Promise<void> {
    const validation = plugin.install.validation;
    if (!validation) {
      return;
    }

    const url = new URL(validation.url);
    await this.assertPublicHost(url.hostname);

    let response: Response;
    try {
      response = await fetch(url, {
        method: validation.method ?? 'GET',
        headers: { Authorization: `Bearer ${apiKey}` },
        redirect: 'error',
        signal: AbortSignal.timeout(VALIDATION_TIMEOUT_MS),
      });
    } catch {
      throw new AppError(
        `Could not reach ${plugin.name} to verify your API key. Please try again.`,
        502,
        ERROR_CODES.UPSTREAM_FAILURE
      );
    }

    if (response.ok) {
      return;
    }
    // Providers signal a bad credential as 401/403, or 400 for a malformed
    // key (e.g. Resend). Anything else is the provider misbehaving, not the key.
    if (response.status === 400 || response.status === 401 || response.status === 403) {
      throw new AppError(`Invalid ${plugin.name} API key`, 400, ERROR_CODES.INVALID_INPUT);
    }
    throw new AppError(
      `${plugin.name} returned an unexpected response (${response.status}) while verifying your API key`,
      502,
      ERROR_CODES.UPSTREAM_FAILURE
    );
  }

  // Known gap: fetch() re-resolves DNS after this check, so a rebinding
  // attacker who controls the hostname could still swap in a private address
  // between check and connect. Accepted for now: validation URLs come from
  // the first-party hosted catalog (https-only, redirect: 'error'), not user
  // input. Closing it fully would need connect-time IP pinning (undici Agent).
  private async assertPublicHost(hostname: string): Promise<void> {
    const reject = (message: string) => {
      throw new AppError(message, 400, ERROR_CODES.INVALID_INPUT);
    };
    if (net.isIP(hostname)) {
      if (isPrivateIp(hostname)) {
        reject('Plugin validation endpoint resolves to a private address, which is not allowed');
      }
      return;
    }
    const [ipv4, ipv6] = await Promise.all([
      dns.resolve4(hostname).catch(() => []),
      dns.resolve6(hostname).catch(() => []),
    ]);
    const addresses = [...ipv4, ...ipv6];
    // Fail closed: an unresolvable host can't be vetted (and can't be valid)
    if (addresses.length === 0) {
      reject('Plugin validation endpoint hostname could not be resolved');
    }
    if (addresses.some(isPrivateIp)) {
      reject('Plugin validation endpoint resolves to a private address, which is not allowed');
    }
  }
}
