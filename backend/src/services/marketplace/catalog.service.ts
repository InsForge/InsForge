import { marketplaceCatalogSchema, type MarketplaceCatalog } from '@insforge/shared-schemas';
import { appConfig } from '@/infra/config/app.config.js';
import logger from '@/utils/logger.js';
import { DEFAULT_MARKETPLACE_CATALOG } from './default-catalog.js';

const CATALOG_CACHE_TTL_MS = 5 * 60 * 1000;
const CATALOG_FETCH_TIMEOUT_MS = 5_000;

/** Origin + path only: the operator-configured URL may carry signed params */
function redactUrl(url: string): string {
  try {
    const parsed = new URL(url);
    return `${parsed.origin}${parsed.pathname}`;
  } catch {
    return '<invalid url>';
  }
}

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
  // Shared in-flight refresh: concurrent callers await the same fetch instead
  // of racing to the bundled fallback while the first fetch is still running
  private inflight: Promise<void> | null = null;

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

    if (!this.inflight && Date.now() - this.lastFetchAt >= CATALOG_CACHE_TTL_MS) {
      this.inflight = this.refresh(url).finally(() => {
        this.inflight = null;
      });
    }
    if (this.inflight) {
      await this.inflight;
    }
    return this.cached ?? DEFAULT_MARKETPLACE_CATALOG;
  }

  /** Never rejects — failures are logged and the previous cache stands */
  private async refresh(url: string): Promise<void> {
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
    } catch (error) {
      logger.warn(
        `Failed to fetch marketplace catalog from ${redactUrl(url)}, using ${
          this.cached ? 'last cached' : 'bundled'
        } catalog: ${error instanceof Error ? error.message : String(error)}`
      );
      // A stale cache is closer to the hosted truth than the bundled fallback
    }
  }

  /** Test hook */
  clearCache(): void {
    this.cached = null;
    this.lastFetchAt = 0;
    this.inflight = null;
  }
}
