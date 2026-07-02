import { apiClient } from '#lib/api/client';
import {
  StorageFileSchema,
  StorageBucketSchema,
  ListObjectsResponseSchema,
  type UploadStrategyResponse,
} from '@insforge/shared-schemas';

export interface ListObjectsParams {
  prefix?: string;
  limit?: number;
  offset?: number;
}

function extractXmlMessage(xml: string): string | null {
  const match = xml.match(/<Message[^>]*>([\s\S]*?)<\/Message>/i);
  if (match && match[1]) {
    return match[1].trim();
  }
  return null;
}

function stripHtmlTags(html: string): string {
  return html
    .replace(/<[^>]*>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

async function parseErrorResponse(response: Response): Promise<string> {
  const contentType = response.headers.get('content-type') || '';

  if (contentType.includes('application/json')) {
    const body = await response.json();
    return body.message || body.error || response.statusText;
  }

  if (contentType.includes('application/xml') || contentType.includes('text/xml')) {
    const text = await response.text();
    const message = extractXmlMessage(text);
    return message || response.statusText;
  }

  if (contentType.includes('text/html')) {
    const text = await response.text();
    const cleaned = stripHtmlTags(text);
    return cleaned || response.statusText;
  }

  const text = await response.text();
  return text || response.statusText;
}

export const storageService = {
  // List all buckets
  async listBuckets(): Promise<StorageBucketSchema[]> {
    const response = await apiClient.request('/storage/buckets', {
      headers: apiClient.withAccessToken(),
    });
    // Traditional REST: API returns array directly
    return response;
  },

  // List objects in a bucket
  async listObjects(
    bucketName: string,
    params?: ListObjectsParams,
    searchQuery?: string
  ): Promise<ListObjectsResponseSchema> {
    const searchParams = new URLSearchParams();
    if (params?.prefix) {
      searchParams.append('prefix', params.prefix);
    }
    if (params?.limit) {
      searchParams.append('limit', params.limit.toString());
    }
    if (params?.offset) {
      searchParams.append('offset', params.offset.toString());
    }
    if (searchQuery && searchQuery.trim()) {
      searchParams.append('search', searchQuery.trim());
    }

    const url = `/storage/buckets/${encodeURIComponent(bucketName)}/objects${searchParams.toString() ? `?${searchParams}` : ''}`;
    const response: {
      data: StorageFileSchema[];
      pagination: { offset: number; limit: number; total: number };
    } = await apiClient.request(url, {
      headers: apiClient.withAccessToken(),
    });

    return {
      objects: response.data,
      pagination: response.pagination,
    };
  },

  // Upload an object to bucket
  async uploadObject(
    bucketName: string,
    objectKey: string,
    object: File
  ): Promise<StorageFileSchema> {
    const token = apiClient.getAccessToken();

    const strategyResponse = await fetch(
      `/api/storage/buckets/${encodeURIComponent(bucketName)}/upload-strategy`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          filename: objectKey,
          contentType: object.type || undefined,
          size: object.size,
        }),
      }
    );

    if (!strategyResponse.ok) {
      const message = await parseErrorResponse(strategyResponse);
      throw new Error(message);
    }

    const strategy: UploadStrategyResponse = await strategyResponse.json();

    if (strategy.method === 'presigned') {
      const formData = new FormData();
      if (strategy.fields) {
        for (const [key, value] of Object.entries(strategy.fields)) {
          formData.append(key, value);
        }
      }
      formData.append('file', object);

      const uploadResponse = await fetch(strategy.uploadUrl, {
        method: 'POST',
        body: formData,
      });

      if (!uploadResponse.ok) {
        const message = await parseErrorResponse(uploadResponse);
        throw new Error(message);
      }

      if (strategy.confirmRequired && strategy.confirmUrl) {
        const etag = uploadResponse.headers.get('etag') || undefined;
        const confirmResponse = await fetch(strategy.confirmUrl, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${token}`,
          },
          body: JSON.stringify({
            size: object.size,
            contentType: object.type || undefined,
            etag,
          }),
        });

        if (!confirmResponse.ok) {
          const message = await parseErrorResponse(confirmResponse);
          throw new Error(message);
        }

        return confirmResponse.json();
      }

      throw new Error('Upload succeeded but no confirm endpoint was provided');
    }

    const formData = new FormData();
    formData.append('file', object);

    const uploadResponse = await fetch(strategy.uploadUrl, {
      method: 'PUT',
      headers: {
        Authorization: `Bearer ${token}`,
      },
      body: formData,
    });

    if (!uploadResponse.ok) {
      const message = await parseErrorResponse(uploadResponse);
      throw new Error(message);
    }

    return uploadResponse.json();
  },

  // Get download URL for an object
  getDownloadUrl(bucketName: string, objectKey: string): string {
    return `/api/storage/buckets/${encodeURIComponent(bucketName)}/objects/${encodeURIComponent(objectKey)}`;
  },

  // Download an object (returns blob)
  async downloadObject(bucketName: string, objectKey: string): Promise<Blob> {
    const response = await fetch(storageService.getDownloadUrl(bucketName, objectKey), {
      headers: {
        Authorization: `Bearer ${apiClient.getAccessToken()}`,
      },
    });
    if (!response.ok) {
      throw new Error(`Failed to download object: ${response.statusText}`);
    }
    return await response.blob();
  },

  // Delete an object
  async deleteObject(bucketName: string, objectKey: string): Promise<void> {
    await apiClient.request(
      `/storage/buckets/${encodeURIComponent(bucketName)}/objects/${encodeURIComponent(objectKey)}`,
      {
        method: 'DELETE',
        headers: apiClient.withAccessToken(),
      }
    );
  },

  async deleteObjects(
    bucketName: string,
    objectKeys: string[]
  ): Promise<{ success: string[]; failures: { key: string; error: Error }[] }> {
    const results = await Promise.allSettled(
      objectKeys.map((key) => this.deleteObject(bucketName, key))
    );
    const success: string[] = [];
    const failures: { key: string; error: Error }[] = [];

    results.forEach((result, index) => {
      if (result.status === 'fulfilled') {
        success.push(objectKeys[index]);
      } else {
        failures.push({ key: objectKeys[index], error: result.reason as Error });
      }
    });

    return { success, failures };
  },

  // Create a new bucket
  async createBucket(bucketName: string, isPublic: boolean = true): Promise<void> {
    await apiClient.request('/storage/buckets', {
      method: 'POST',
      headers: apiClient.withAccessToken(),
      body: JSON.stringify({ bucketName: bucketName, isPublic: isPublic }),
    });
  },

  // Delete entire bucket
  async deleteBucket(bucketName: string): Promise<void> {
    await apiClient.request(`/storage/buckets/${encodeURIComponent(bucketName)}`, {
      method: 'DELETE',
      headers: apiClient.withAccessToken(),
    });
  },

  // Edit bucket (update visibility or other config)
  async editBucket(bucketName: string, config: { isPublic: boolean }): Promise<void> {
    await apiClient.request(`/storage/buckets/${encodeURIComponent(bucketName)}`, {
      method: 'PATCH',
      headers: apiClient.withAccessToken(),
      body: JSON.stringify(config),
    });
  },
};
