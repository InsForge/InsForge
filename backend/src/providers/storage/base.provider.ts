import { Readable } from 'stream';
import { UploadStrategyResponse, DownloadStrategyResponse } from '@insforge/shared-schemas';

export interface ObjectMetadata {
  size: number;
  etag: string;
  contentType?: string;
  lastModified: Date;
}

export interface GetObjectResult extends ObjectMetadata {
  body: Readable;
}

/**
 * Storage provider interface
 * Defines the contract that all storage providers must implement
 */
export interface StorageProvider {
  initialize(): void | Promise<void>;
  putObject(bucket: string, key: string, file: Express.Multer.File): Promise<void>;
  getObject(bucket: string, key: string): Promise<Buffer | null>;
  deleteObject(bucket: string, key: string): Promise<void>;
  createBucket(bucket: string): Promise<void>;
  deleteBucket(bucket: string): Promise<void>;

  // Presigned URL support
  supportsPresignedUrls(): boolean;
  getUploadStrategy(
    bucket: string,
    key: string,
    metadata: { contentType?: string; size?: number },
    maxFileSizeBytes: number
  ): Promise<UploadStrategyResponse>;
  getDownloadStrategy(
    bucket: string,
    key: string,
    expiresIn?: number,
    isPublic?: boolean
  ): Promise<DownloadStrategyResponse>;
  verifyObjectExists(bucket: string, key: string): Promise<{ exists: boolean; size?: number }>;

  // ==========================================================================
  // S3 Protocol extensions — required by the /storage/v1/s3 gateway.
  // LocalStorageProvider throws NOT_IMPLEMENTED for all of these.
  // ==========================================================================

  putObjectStream(
    bucket: string,
    key: string,
    body: Readable,
    opts: { contentType?: string; contentLength?: number }
  ): Promise<{ etag: string; size: number }>;

  headObject(bucket: string, key: string): Promise<ObjectMetadata | null>;

  copyObject(
    srcBucket: string,
    srcKey: string,
    dstBucket: string,
    dstKey: string
  ): Promise<{ etag: string; lastModified: Date }>;

  getObjectStream(
    bucket: string,
    key: string,
    opts?: { range?: string }
  ): Promise<GetObjectResult>;

  createMultipartUpload(
    bucket: string,
    key: string,
    opts: { contentType?: string }
  ): Promise<{ uploadId: string }>;

  uploadPart(
    bucket: string,
    key: string,
    uploadId: string,
    partNumber: number,
    body: Readable,
    contentLength: number
  ): Promise<{ etag: string }>;

  completeMultipartUpload(
    bucket: string,
    key: string,
    uploadId: string,
    parts: Array<{ partNumber: number; etag: string }>
  ): Promise<{ etag: string; size: number }>;

  abortMultipartUpload(bucket: string, key: string, uploadId: string): Promise<void>;

  listParts(
    bucket: string,
    key: string,
    uploadId: string,
    opts: { maxParts?: number; partNumberMarker?: number }
  ): Promise<{
    parts: Array<{ partNumber: number; etag: string; size: number; lastModified: Date }>;
    isTruncated: boolean;
    nextPartNumberMarker?: number;
  }>;
}
