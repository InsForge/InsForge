import { apiClient } from '#lib/api/client';
import type {
  ListCollectionsResponse,
  VectorCollection,
  VectorQueryResponse,
  VectorMatch,
} from '@insforge/shared-schemas';

export class VectorStoreService {
  async listCollections(): Promise<VectorCollection[]> {
    const data = (await apiClient.request('/vectors/collections', {
      headers: apiClient.withAccessToken(),
    })) as ListCollectionsResponse;
    return data.collections;
  }

  async createCollection(name: string): Promise<VectorCollection> {
    const data = (await apiClient.request('/vectors/collections', {
      method: 'POST',
      headers: apiClient.withAccessToken(),
      body: JSON.stringify({ name }),
    })) as { collection: VectorCollection };
    return data.collection;
  }

  async deleteCollection(name: string): Promise<boolean> {
    const data = (await apiClient.request(`/vectors/collections/${encodeURIComponent(name)}`, {
      method: 'DELETE',
      headers: apiClient.withAccessToken(),
    })) as { deleted: boolean };
    return data.deleted;
  }

  async query(name: string, text: string, topK: number): Promise<VectorMatch[]> {
    const data = (await apiClient.request(
      `/vectors/collections/${encodeURIComponent(name)}/query`,
      {
        method: 'POST',
        headers: apiClient.withAccessToken(),
        body: JSON.stringify({ text, topK }),
      }
    )) as VectorQueryResponse;
    return data.matches;
  }
}

export const vectorStoreService = new VectorStoreService();
