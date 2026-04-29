import { getPosthogProvider, type PosthogProvider } from '@/providers/posthog/index.js';

export class PosthogService {
  private provider: PosthogProvider;

  constructor(provider: PosthogProvider = getPosthogProvider()) {
    this.provider = provider;
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
}
