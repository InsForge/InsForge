import { appConfig } from '@/infra/config/app.config.js';
import type { WebscraperProvider } from '@/providers/webscraper/base.provider.js';
import { CloudWebscraperProvider } from '@/providers/webscraper/cloud.provider.js';
import { LocalWebscraperProvider } from '@/providers/webscraper/local.provider.js';
import { ApifyConfigService } from '@/services/webscraper/apify-config.service.js';

// Wraps the data-source providers (Apify first; others slot in later). Resolves
// per call, like EmailService, so a config change takes effect without a restart.
export class WebscraperService {
  private static instance: WebscraperService;

  constructor(
    private readonly cloud: WebscraperProvider = CloudWebscraperProvider.getInstance(),
    // Typed as the concrete class, not the interface: `setApifyToken` needs
    // `verifyToken`, which is local-only (cloud tokens come from OAuth). Every
    // other call site treats it as a plain WebscraperProvider.
    private readonly local: LocalWebscraperProvider = LocalWebscraperProvider.getInstance(),
    private readonly config: ApifyConfigService = ApifyConfigService.getInstance()
  ) {}

  static getInstance(): WebscraperService {
    if (!WebscraperService.instance) {
      WebscraperService.instance = new WebscraperService();
    }
    return WebscraperService.instance;
  }

  // A project id is what lets the cloud provider sign a project JWT and reach
  // cloud-backend at all. Without one there is nothing to proxy to, so the local
  // provider owns the request.
  static isSelfHosted(): boolean {
    const projectId = appConfig.cloud.projectId;
    return !projectId || projectId === 'local';
  }

  private provider(): WebscraperProvider {
    return WebscraperService.isSelfHosted() ? this.local : this.cloud;
  }

  getApifyConnection() {
    return this.provider().getConnection();
  }

  disconnectApify() {
    return this.provider().disconnect();
  }

  getApifyToken() {
    return this.provider().getToken();
  }

  getApifyRuns(limit: number) {
    return this.provider().getRuns(limit);
  }

  getApifyActors(limit: number) {
    return this.provider().getActors(limit);
  }

  getApifyDatasets(limit: number) {
    return this.provider().getDatasets(limit);
  }

  getApifyLatestData(limit: number) {
    return this.provider().getLatestData(limit);
  }

  // Verify before storing, so a bad paste fails loudly instead of producing a
  // connection that 401s on every subsequent read. Trim once, up front:
  // setToken() trims before persisting, so verifying the untrimmed value would
  // reject a token over whitespace that never reaches the store — a real path,
  // since the CLI forwards `--token` verbatim and `$(cat token.txt)` carries a
  // trailing newline.
  async setApifyToken(apiToken: string) {
    const token = apiToken.trim();
    await this.local.verifyToken(token);
    return this.config.setToken(token);
  }
}
