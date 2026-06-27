import { ApifyProvider } from '@/providers/webscraper/apify.provider.js';

// Wraps the data-source providers (Apify first; others slot in later). Mirrors
// AnalyticsService's thin delegation over PostHogProvider.
export class WebscraperService {
  private static instance: WebscraperService;
  private apify: ApifyProvider;

  constructor(apify: ApifyProvider = ApifyProvider.getInstance()) {
    this.apify = apify;
  }

  static getInstance(): WebscraperService {
    if (!WebscraperService.instance) {
      WebscraperService.instance = new WebscraperService();
    }
    return WebscraperService.instance;
  }

  getApifyConnection() {
    return this.apify.getConnection();
  }

  disconnectApify() {
    return this.apify.disconnect();
  }

  getApifyToken() {
    return this.apify.getToken();
  }

  getApifyRuns(limit: number) {
    return this.apify.getRuns(limit);
  }

  getApifyLatestData(limit: number) {
    return this.apify.getLatestData(limit);
  }
}
