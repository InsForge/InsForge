import { PostHogProvider } from '@/providers/analytics/posthog.provider.js';

export class AnalyticsService {
  private static instance: AnalyticsService;
  private provider: PostHogProvider;

  constructor(provider: PostHogProvider = PostHogProvider.getInstance()) {
    this.provider = provider;
  }

  static getInstance(): AnalyticsService {
    if (!AnalyticsService.instance) {
      AnalyticsService.instance = new AnalyticsService();
    }
    return AnalyticsService.instance;
  }

  getConnection() {
    return this.provider.getConnection();
  }

  getDashboards() {
    return this.provider.getDashboards();
  }

  getSummary() {
    return this.provider.getSummary();
  }

  getRecentEvents(limit?: number) {
    return this.provider.getRecentEvents(limit);
  }

  disconnect() {
    return this.provider.disconnect();
  }

  getWebOverview(timeframe: string) {
    return this.provider.getWebOverview(timeframe);
  }

  getWebStats(breakdown: string, timeframe: string) {
    return this.provider.getWebStats(breakdown, timeframe);
  }

  getTrends(metric: string, timeframe: string) {
    return this.provider.getTrends(metric, timeframe);
  }

  getRetention() {
    return this.provider.getRetention();
  }

  getRecordings(limit?: number) {
    return this.provider.getRecordings(limit);
  }

  createRecordingShare(recordingId: string) {
    return this.provider.createRecordingShare(recordingId);
  }
}
