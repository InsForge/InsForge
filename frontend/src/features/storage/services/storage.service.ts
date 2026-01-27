import { apiClient } from '@/lib/api/client';
import {
  StorageFileSchema,
  StorageBucketSchema,
  ListObjectsResponseSchema,
} from '@insforge/shared-schemas';

export interface ListObjectsParams {
  prefix?: string;
  limit?: number;
  offset?: number;
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
    const formData = new FormData();
    formData.append('file', object);

    // Use fetch directly for object uploads to avoid Content-Type header issues
    const response = await fetch(
      `/api/storage/buckets/${encodeURIComponent(bucketName)}/objects/${encodeURIComponent(objectKey)}`,
      {
        method: 'PUT',
        headers: {
          Authorization: `Bearer ${apiClient.getAccessToken()}`,
        },
        body: formData,
      }
    );

    if (!response.ok) {
      const error = await response.json();
      // Traditional REST error format
      throw new Error(error.message || error.error || 'Upload failed');
    }

    const result = await response.json();
    // Traditional REST: response returned directly
    return result;
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
