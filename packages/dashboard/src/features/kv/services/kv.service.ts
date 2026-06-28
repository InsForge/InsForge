import { apiClient } from '#lib/api/client';
import type { KvListResponse, KvSetResponse, KvSetRequest } from '@insforge/shared-schemas';

function entryPath(namespace: string, key?: string): string {
  const base = `/kv/entries/${encodeURIComponent(namespace)}`;
  return key === undefined ? base : `${base}/${encodeURIComponent(key)}`;
}

export class KvService {
  async listKeys(namespace: string): Promise<KvListResponse['keys']> {
    const data = (await apiClient.request(entryPath(namespace), {
      headers: apiClient.withAccessToken(),
    })) as KvListResponse;
    return data.keys;
  }

  async getValue(namespace: string, key: string): Promise<unknown> {
    const data = (await apiClient.request(entryPath(namespace, key), {
      headers: apiClient.withAccessToken(),
    })) as { value: unknown };
    return data.value;
  }

  async setValue(namespace: string, key: string, input: KvSetRequest): Promise<KvSetResponse> {
    return (await apiClient.request(entryPath(namespace, key), {
      method: 'PUT',
      headers: apiClient.withAccessToken(),
      body: JSON.stringify(input),
    })) as KvSetResponse;
  }

  async deleteKey(namespace: string, key: string): Promise<boolean> {
    const data = (await apiClient.request(entryPath(namespace, key), {
      method: 'DELETE',
      headers: apiClient.withAccessToken(),
    })) as { deleted: boolean };
    return data.deleted;
  }
}

export const kvService = new KvService();
