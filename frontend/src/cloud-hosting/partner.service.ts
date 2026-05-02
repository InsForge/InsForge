interface PartnershipConfig {
  partner_sites: string[];
}

const PARTNERSHIP_CONFIG_URL = 'https://config.insforge.dev/partnership.json';
const FAILED_FETCH_RETRY_MS = 60_000;

function normalizeOrigin(value: string): string | null {
  try {
    return new URL(value).origin;
  } catch {
    return null;
  }
}

export class PartnerService {
  private partnerOriginsCache: Set<string> | null = null;
  private fetchPromise: Promise<Set<string>> | null = null;
  private lastFetchFailureAt: number | null = null;

  async fetchPartnerOrigins(): Promise<Set<string>> {
    if (this.partnerOriginsCache) {
      return this.partnerOriginsCache;
    }

    // Avoid retry storms when the partnership config is temporarily unavailable.
    if (
      this.lastFetchFailureAt !== null &&
      Date.now() - this.lastFetchFailureAt < FAILED_FETCH_RETRY_MS
    ) {
      return new Set<string>();
    }

    if (this.fetchPromise) {
      return this.fetchPromise;
    }

    this.fetchPromise = (async () => {
      try {
        const response = await fetch(PARTNERSHIP_CONFIG_URL);
        if (!response.ok) {
          console.warn('Failed to fetch partnership config:', response.status);
          this.lastFetchFailureAt = Date.now();
          return new Set<string>();
        }

        const data = (await response.json()) as PartnershipConfig;
        const partnerOrigins = Array.isArray(data?.partner_sites)
          ? data.partner_sites.flatMap((site) => {
              const normalized = typeof site === 'string' ? normalizeOrigin(site) : null;
              return normalized ? [normalized] : [];
            })
          : [];

        this.lastFetchFailureAt = null;
        this.partnerOriginsCache = new Set(partnerOrigins);
        return this.partnerOriginsCache;
      } catch (error) {
        console.warn('Error fetching partnership config:', error);
        this.lastFetchFailureAt = Date.now();
        return new Set<string>();
      } finally {
        this.fetchPromise = null;
      }
    })();

    return this.fetchPromise;
  }
}

export const partnerService = new PartnerService();
