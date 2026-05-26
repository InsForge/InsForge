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
  /**
   * Write a multipart-form upload to storage. Returns `etag` so the service
   * can persist it for cache-busting download URLs (`?v=<etag>`). Providers
   * that have no native digest (local fs) compute one from the bytes so the
   * URL still changes when content changes.
   */
  putObject(bucket: string, key: string, file: Express.Multer.File): Promise<{ etag: string }>;
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
  /**
   * Generate a download URL. The optional `version` is a cache-bust stamp
   * (etag/uploaded_at-ms) that providers may incorporate into the URL where
   * safe. Specifically: CloudFront signed URLs and local direct URLs tolerate
   * extra query params, but raw S3 SigV4 presigned URLs do NOT — the
   * signature covers every query parameter, and appending `?v=` after signing
   * yields `SignatureDoesNotMatch` 403. The S3 provider therefore ignores
   * `version` on the raw-presigned path (there is no CDN in front to bust
   * anyway when CloudFront is not configured).
   */
  getDownloadStrategy(
    bucket: string,
    key: string,
    expiresIn?: number,
    isPublic?: boolean,
    version?: string | null
  ): Promise<DownloadStrategyResponse>;
  /**
   * Confirms an object exists in the backing store and returns its
   * authoritative size and etag. `confirmUpload` uses this to overwrite the
   * client-supplied etag — browsers don't expose `ETag` on cross-origin S3
   * responses unless the bucket CORS allowlists it, so trusting the client
   * leaves a hole where the DB row has no etag and CDN cache-busting
   * silently degrades on overwrites.
   */
  verifyObjectExists(
    bucket: string,
    key: string
  ): Promise<{ exists: boolean; size?: number; etag?: string }>;

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

  getObjectStream(bucket: string, key: string, opts?: { range?: string }): Promise<GetObjectResult>;

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
