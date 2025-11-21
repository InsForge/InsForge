export interface PartnershipConfig {
  partner_sites: string[];
}

export class PartnershipService {
  private configCache: PartnershipConfig | null = null;
  private fetchPromise: Promise<PartnershipConfig | null> | null = null;
  private readonly CONFIG_URL =
    'https://insforge-config.s3.us-east-2.amazonaws.com/partnership.json';

  /**
   * Fetches the partnership configuration from S3
   * Uses caching to avoid repeated fetches
   */
  async fetchConfig(): Promise<PartnershipConfig | null> {
    // Return cached config if available
    if (this.configCache) {
      return this.configCache;
    }

    // If a fetch is already in progress, wait for it
    if (this.fetchPromise) {
      return this.fetchPromise;
    }

    // Start a new fetch
    this.fetchPromise = (async () => {
      try {
        const response = await fetch(this.CONFIG_URL);
        if (response.ok) {
          this.configCache = await response.json();
          return this.configCache;
        } else {
          console.warn('Failed to fetch partnership config:', response.status);
          return null;
        }
      } catch (error) {
        console.warn('Error fetching partnership config:', error);
        return null;
      } finally {
        this.fetchPromise = null;
      }
    })();

    return this.fetchPromise;
  }

  /**
   * Clears the cached configuration (useful for testing or forcing refresh)
   */
  clearCache(): void {
    this.configCache = null;
    this.fetchPromise = null;
  }
}

export const partnershipService = new PartnershipService();
