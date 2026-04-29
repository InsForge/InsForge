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

  disconnect() {
    return this.provider.disconnect();
  }
}
