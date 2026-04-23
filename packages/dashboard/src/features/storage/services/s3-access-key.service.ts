import { apiClient } from '../../../lib/api/client';
import type {
  S3AccessKeySchema,
  S3AccessKeyWithSecretSchema,
  CreateS3AccessKeyRequest,
} from '@insforge/shared-schemas';

/** Client-side service for managing project-scoped S3 access keys. */
export class S3AccessKeyService {
  /** List every access key for this project (no plaintext secrets). */
  async list(): Promise<S3AccessKeySchema[]> {
    return apiClient.request('/storage/s3/access-keys');
  }

  /**
   * Create a new access key. The returned `secretAccessKey` is plaintext
   * and only returned on this call — the caller must capture it here.
   */
  async create(input: CreateS3AccessKeyRequest): Promise<S3AccessKeyWithSecretSchema> {
    return apiClient.request('/storage/s3/access-keys', {
      method: 'POST',
      body: JSON.stringify(input),
    });
  }

  /** Revoke an access key by id. Invalidates the server-side LRU cache. */
  async delete(id: string): Promise<void> {
    await apiClient.request(`/storage/s3/access-keys/${id}`, {
      method: 'DELETE',
      returnFullResponse: true,
    });
  }
}

export const s3AccessKeyService = new S3AccessKeyService();
