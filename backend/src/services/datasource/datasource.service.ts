import { ApifyProvider } from '@/providers/datasource/apify.provider.js';

// Wraps the data-source providers (Apify first; others slot in later). Mirrors
// AnalyticsService's thin delegation over PostHogProvider.
export class DatasourceService {
  private static instance: DatasourceService;
  private apify: ApifyProvider;

  constructor(apify: ApifyProvider = ApifyProvider.getInstance()) {
    this.apify = apify;
  }

  static getInstance(): DatasourceService {
    if (!DatasourceService.instance) {
      DatasourceService.instance = new DatasourceService();
    }
    return DatasourceService.instance;
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
}
