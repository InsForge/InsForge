import { marketplaceCatalogSchema, type MarketplaceCatalog } from '@insforge/shared-schemas';
import { appConfig } from '@/infra/config/app.config.js';
import logger from '@/utils/logger.js';
import { DEFAULT_MARKETPLACE_CATALOG } from './default-catalog.js';

const CATALOG_CACHE_TTL_MS = 5 * 60 * 1000;
const CATALOG_FETCH_TIMEOUT_MS = 5_000;

/**
 * Fetches the hosted marketplace.json (S3/CDN, provisioned by
 * insforge-cloudbackend), caching it in memory. Any failure — no URL
 * configured, network error, non-2xx, or a payload that doesn't conform to
 * marketplaceCatalogSchema — falls back to the bundled catalog so the
 * marketplace keeps working on offline/self-hosted instances.
 */
export class MarketplaceCatalogService {
  private static instance: MarketplaceCatalogService;
  private cached: MarketplaceCatalog | null = null;
  // Timestamp of the last fetch attempt (success or failure): an unreachable
  // catalog URL is retried at most once per TTL, so offline self-hosted
  // instances aren't stalled by a fetch timeout on every marketplace request
  private lastFetchAt = 0;

  static getInstance(): MarketplaceCatalogService {
    if (!MarketplaceCatalogService.instance) {
      MarketplaceCatalogService.instance = new MarketplaceCatalogService();
    }
    return MarketplaceCatalogService.instance;
  }

  async getCatalog(): Promise<MarketplaceCatalog> {
    const url = appConfig.marketplace.catalogUrl;
    if (!url) {
      return DEFAULT_MARKETPLACE_CATALOG;
    }

    if (Date.now() - this.lastFetchAt < CATALOG_CACHE_TTL_MS) {
      return this.cached ?? DEFAULT_MARKETPLACE_CATALOG;
    }
    this.lastFetchAt = Date.now();

    try {
      const response = await fetch(url, {
        signal: AbortSignal.timeout(CATALOG_FETCH_TIMEOUT_MS),
      });
      if (!response.ok) {
        throw new Error(`Catalog fetch returned ${response.status}`);
      }
      const parsed = marketplaceCatalogSchema.safeParse(await response.json());
      if (!parsed.success) {
        throw new Error(`Catalog payload failed validation: ${parsed.error.message}`);
      }
      this.cached = parsed.data;
      return parsed.data;
    } catch (error) {
      logger.warn(
        `Failed to fetch marketplace catalog from ${url}, using ${
          this.cached ? 'last cached' : 'bundled'
        } catalog: ${error instanceof Error ? error.message : String(error)}`
      );
      // A stale cache is closer to the hosted truth than the bundled fallback
      return this.cached ?? DEFAULT_MARKETPLACE_CATALOG;
    }
  }

  /** Test hook */
  clearCache(): void {
    this.cached = null;
    this.lastFetchAt = 0;
  }
}
