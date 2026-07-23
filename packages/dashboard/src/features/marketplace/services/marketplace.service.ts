import { apiClient } from '#lib/api/client';
import type {
  InstallMarketplacePluginResponse,
  ListMarketplacePluginsResponse,
  MarketplacePluginWithStatus,
  UninstallMarketplacePluginResponse,
} from '@insforge/shared-schemas';

export class MarketplaceService {
  async listPlugins(): Promise<MarketplacePluginWithStatus[]> {
    const data = (await apiClient.request('/marketplace/plugins', {
      headers: apiClient.withAccessToken(),
    })) as ListMarketplacePluginsResponse;
    return data.plugins;
  }

  async installPlugin(slug: string, apiKey: string): Promise<InstallMarketplacePluginResponse> {
    return apiClient.request(`/marketplace/plugins/${encodeURIComponent(slug)}/install`, {
      method: 'POST',
      headers: apiClient.withAccessToken(),
      body: JSON.stringify({ apiKey }),
    });
  }

  async uninstallPlugin(slug: string): Promise<UninstallMarketplacePluginResponse> {
    return apiClient.request(`/marketplace/plugins/${encodeURIComponent(slug)}`, {
      method: 'DELETE',
      headers: apiClient.withAccessToken(),
    });
  }
}

export const marketplaceService = new MarketplaceService();
