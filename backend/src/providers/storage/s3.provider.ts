import {
  S3Client,
  PutObjectCommand,
  GetObjectCommand,
  DeleteObjectCommand,
  ListObjectsV2Command,
  DeleteObjectsCommand,
  HeadObjectCommand,
  CopyObjectCommand,
  CreateMultipartUploadCommand,
  UploadPartCommand,
  CompleteMultipartUploadCommand,
  AbortMultipartUploadCommand,
  ListPartsCommand,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { createPresignedPost } from '@aws-sdk/s3-presigned-post';
import { getSignedUrl as getCloudFrontSignedUrl } from '@aws-sdk/cloudfront-signer';
import { Readable } from 'stream';
import { UploadStrategyResponse, DownloadStrategyResponse } from '@insforge/shared-schemas';
import { StorageProvider, ObjectMetadata, GetObjectResult } from './base.provider.js';
import logger from '@/utils/logger.js';

function stripEtagQuotes(etag: string | undefined): string {
  return (etag ?? '').replace(/^"(.*)"$/, '$1');
}

// S3-compatible backends surface "object doesn't exist" in various shapes:
// native AWS S3 throws `NotFound`, MinIO and some proxies throw `NoSuchKey`,
// and a few older SDKs only set `$metadata.httpStatusCode`. Treat all three
// as a miss so headObject() can honour its Promise<... | null> contract
// without leaking a thrown error to callers.
function isS3NotFound(err: unknown): boolean {
  const e = err as { name?: string; Code?: string; $metadata?: { httpStatusCode?: number } };
  return (
    e?.name === 'NotFound' ||
    e?.name === 'NoSuchKey' ||
    e?.Code === 'NoSuchKey' ||
    e?.$metadata?.httpStatusCode === 404
  );
}

const ONE_HOUR_IN_SECONDS = 3600;
const SEVEN_DAYS_IN_SECONDS = 604800;

/**
 * S3 storage implementation
 */
export class S3StorageProvider implements StorageProvider {
  private s3Client: S3Client | null = null;

  constructor(
    private s3Bucket: string,
    private appKey: string,
    private region: string = 'us-east-2',
    /**
     * When set, this provider runs in branch mode: read methods try the
     * branch's S3 path first, then fall back to the parent's path on 404.
     * Writes (put/delete/copy/multipart) are NEVER directed to the parent
     * path. Injected by StorageService from the PARENT_APP_KEY env var
     * that cloud-backend sets at branch EC2 startup.
     */
    private parentAppKey?: string
  ) {}

  initialize(): void {
    // Use explicit AWS credentials if provided (local dev or self hosting)
    // Otherwise, use IAM role credentials (EC2 production)
    const s3Config: {
      region: string;
      credentials?: { accessKeyId: string; secretAccessKey: string };
      endpoint?: string;
      forcePathStyle?: boolean;
    } = {
      region: this.region,
    };

    // Use S3-specific credentials as a pair, otherwise fall back to AWS credentials as a pair
    const useS3Creds = process.env.S3_ACCESS_KEY_ID && process.env.S3_SECRET_ACCESS_KEY;
    const accessKeyId = useS3Creds ? process.env.S3_ACCESS_KEY_ID : process.env.AWS_ACCESS_KEY_ID;
    const secretAccessKey = useS3Creds
      ? process.env.S3_SECRET_ACCESS_KEY
      : process.env.AWS_SECRET_ACCESS_KEY;

    if (accessKeyId && secretAccessKey) {
      s3Config.credentials = { accessKeyId, secretAccessKey };
    }

    // Support MinIO or other S3-compatible endpoints
    if (process.env.S3_ENDPOINT_URL) {
      s3Config.endpoint = process.env.S3_ENDPOINT_URL;
      // MinIO requires path-style URLs
      s3Config.forcePathStyle = true;
    }

    this.s3Client = new S3Client(s3Config);
  }

  private getS3Key(bucket: string, key: string): string {
    return `${this.appKey}/${bucket}/${key}`;
  }

  /**
   * Parent's S3 key path for the same bucket+key, when this provider is in
   * branch mode. Returns null when no parent is configured (regular project).
   */
  private getParentS3Key(bucket: string, key: string): string | null {
    return this.parentAppKey ? `${this.parentAppKey}/${bucket}/${key}` : null;
  }

  /**
   * Branch fallback wrapper for read paths: try the branch's S3 key first;
   * on a "not found" miss (provider returned null), retry with the parent's
   * S3 key when one is configured. Errors other than NotFound propagate.
   */
  private async withFallback<T>(
    branchPath: string,
    parentPath: string | null,
    op: (s3Key: string) => Promise<T | null>,
  ): Promise<T | null> {
    const primary = await op(branchPath);
    if (primary !== null) return primary;
    if (!parentPath) return null;
    return op(parentPath);
  }

  async putObject(bucket: string, key: string, file: Express.Multer.File): Promise<void> {
    if (!this.s3Client) {
      throw new Error('S3 client not initialized');
    }
    const s3Key = this.getS3Key(bucket, key);

    const command = new PutObjectCommand({
      Bucket: this.s3Bucket,
      Key: s3Key,
      Body: file.buffer,
      ContentType: file.mimetype || 'application/octet-stream',
    });

    try {
      await this.s3Client.send(command);
    } catch (error) {
      logger.error('S3 Upload error', {
        error: error instanceof Error ? error.message : String(error),
        bucket,
        key: s3Key,
      });
      throw error;
    }
  }

  async getObject(bucket: string, key: string): Promise<Buffer | null> {
    if (!this.s3Client) {
      throw new Error('S3 client not initialized');
    }
    return this.withFallback(
      this.getS3Key(bucket, key),
      this.getParentS3Key(bucket, key),
      async (s3Key) => this.tryGetObject(s3Key),
    );
  }

  private async tryGetObject(s3Key: string): Promise<Buffer | null> {
    try {
      const command = new GetObjectCommand({
        Bucket: this.s3Bucket,
        Key: s3Key,
      });
      const response = await this.s3Client!.send(command);
      const chunks: Uint8Array[] = [];
      const body = response.Body as AsyncIterable<Uint8Array>;
      for await (const chunk of body) {
        chunks.push(chunk);
      }
      return Buffer.concat(chunks);
    } catch (err) {
      if (isS3NotFound(err)) return null;
      // Match prior behaviour: any error → null. Branch fallback only kicks
      // in for NotFound; non-404 errors are still treated as "no object" so
      // service-layer behaviour is unchanged.
      return null;
    }
  }

  async deleteObject(bucket: string, key: string): Promise<void> {
    if (!this.s3Client) {
      throw new Error('S3 client not initialized');
    }
    const command = new DeleteObjectCommand({
      Bucket: this.s3Bucket,
      Key: this.getS3Key(bucket, key),
    });
    await this.s3Client.send(command);
  }

  async createBucket(_bucket: string): Promise<void> {
    // In S3 with multi-tenant, we don't create actual buckets
    // We just use folders under the app key
  }

  async deleteBucket(bucket: string): Promise<void> {
    if (!this.s3Client) {
      throw new Error('S3 client not initialized');
    }
    // List and delete all objects in the "bucket" (folder)
    const prefix = `${this.appKey}/${bucket}/`;

    let continuationToken: string | undefined;
    do {
      const listCommand = new ListObjectsV2Command({
        Bucket: this.s3Bucket,
        Prefix: prefix,
        ContinuationToken: continuationToken,
      });
      const listResponse = await this.s3Client.send(listCommand);

      if (listResponse.Contents && listResponse.Contents.length) {
        const deleteCommand = new DeleteObjectsCommand({
          Bucket: this.s3Bucket,
          Delete: {
            Objects: listResponse.Contents.filter((obj) => obj.Key !== undefined).map((obj) => ({
              Key: obj.Key as string,
            })),
          },
        });
        await this.s3Client.send(deleteCommand);
      }

      continuationToken = listResponse.NextContinuationToken;
    } while (continuationToken);
  }

  // S3 supports presigned URLs
  supportsPresignedUrls(): boolean {
    return true;
  }

  async getUploadStrategy(
    bucket: string,
    key: string,
    metadata: { contentType?: string; size?: number },
    maxFileSizeBytes: number
  ): Promise<UploadStrategyResponse> {
    if (!this.s3Client) {
      throw new Error('S3 client not initialized');
    }

    const s3Key = this.getS3Key(bucket, key);
    const expiresIn = ONE_HOUR_IN_SECONDS; // 1 hour

    try {
      // Generate presigned POST URL for multipart form upload
      const { url, fields } = await createPresignedPost(this.s3Client, {
        Bucket: this.s3Bucket,
        Key: s3Key,
        Conditions: [
          [
            'content-length-range',
            0,
            Math.min(metadata.size || maxFileSizeBytes, maxFileSizeBytes),
          ],
        ],
        Expires: expiresIn,
      });

      return {
        method: 'presigned',
        uploadUrl: url,
        fields,
        key,
        confirmRequired: true,
        confirmUrl: `/api/storage/buckets/${bucket}/objects/${encodeURIComponent(key)}/confirm-upload`,
        expiresAt: new Date(Date.now() + expiresIn * 1000),
      };
    } catch (error) {
      logger.error('Failed to generate presigned upload URL', {
        error: error instanceof Error ? error.message : String(error),
        bucket,
        key,
      });
      throw error;
    }
  }

  async getDownloadStrategy(
    bucket: string,
    key: string,
    expiresIn: number = ONE_HOUR_IN_SECONDS,
    isPublic: boolean = false
  ): Promise<DownloadStrategyResponse> {
    if (!this.s3Client) {
      throw new Error('S3 client not initialized');
    }

    // In branch mode, HEAD the branch path first; if missing and a parent
    // is configured, sign the parent's S3 path instead. The HEAD adds one
    // round-trip but is required: we can't tell from key alone whether the
    // object lives on the branch or fell through to parent.
    const branchKey = this.getS3Key(bucket, key);
    const parentKey = this.getParentS3Key(bucket, key);
    let s3Key = branchKey;
    if (parentKey) {
      const branchExists = await this.tryHeadObject(branchKey);
      if (!branchExists) {
        s3Key = parentKey;
      }
    }
    // Public files get longer expiration (7 days), private files get shorter (1 hour default)
    const actualExpiresIn = isPublic ? SEVEN_DAYS_IN_SECONDS : expiresIn; // 604800 = 7 days
    const cloudFrontUrl = process.env.AWS_CLOUDFRONT_URL;

    try {
      // If CloudFront URL is configured and not using a custom S3 endpoint, use CloudFront for downloads
      // CloudFront only works with AWS S3, not with S3-compatible providers like Wasabi/MinIO
      if (cloudFrontUrl && !process.env.S3_ENDPOINT_URL) {
        const cloudFrontKeyPairId = process.env.AWS_CLOUDFRONT_KEY_PAIR_ID;
        const cloudFrontPrivateKey = process.env.AWS_CLOUDFRONT_PRIVATE_KEY;

        if (!cloudFrontKeyPairId || !cloudFrontPrivateKey) {
          logger.warn(
            'CloudFront URL configured but missing key pair ID or private key, falling back to S3'
          );
        } else {
          try {
            // Generate CloudFront signed URL
            // IMPORTANT: URL-encode the S3 key to match what CloudFront receives
            // This ensures the signature matches for files with spaces, parentheses, etc.
            const encodedS3Key = s3Key
              .split('/')
              .map((segment) => encodeURIComponent(segment))
              .join('/');
            const cloudFrontObjectUrl = `${cloudFrontUrl.replace(/\/$/, '')}/${encodedS3Key}`;

            // Convert escaped newlines to actual newlines in the private key
            const formattedPrivateKey = cloudFrontPrivateKey.replace(/\\n/g, '\n');

            // dateLessThan can be string | number | Date - using Date object directly
            const dateLessThan = new Date(Date.now() + actualExpiresIn * 1000);

            const signedUrl = getCloudFrontSignedUrl({
              url: cloudFrontObjectUrl,
              keyPairId: cloudFrontKeyPairId,
              privateKey: formattedPrivateKey,
              dateLessThan,
            });

            logger.info('CloudFront signed URL generated successfully.');

            return {
              method: 'presigned',
              url: signedUrl,
              expiresAt: dateLessThan,
            };
          } catch (cfError) {
            logger.error('Failed to generate CloudFront signed URL, falling back to S3', {
              error: cfError instanceof Error ? cfError.message : String(cfError),
              bucket,
              key,
            });
            // Fall through to S3 signed URL generation
          }
        }
      }

      // Note: isPublic here refers to the application-level setting,
      // not the actual S3 bucket policy. In a multi-tenant setup,
      // we're using a single S3 bucket with folder-based isolation,
      // so we always use presigned URLs for security.
      // The "public" setting only affects the URL expiration time.

      // Always generate presigned URL for security in multi-tenant environment
      const command = new GetObjectCommand({
        Bucket: this.s3Bucket,
        Key: s3Key,
      });

      const url = await getSignedUrl(this.s3Client, command, { expiresIn: actualExpiresIn });

      return {
        method: 'presigned',
        url,
        expiresAt: new Date(Date.now() + actualExpiresIn * 1000),
      };
    } catch (error) {
      logger.error('Failed to generate download URL', {
        error: error instanceof Error ? error.message : String(error),
        bucket,
        key,
      });
      throw error;
    }
  }

  async verifyObjectExists(
    bucket: string,
    key: string
  ): Promise<{ exists: boolean; size?: number }> {
    if (!this.s3Client) {
      throw new Error('S3 client not initialized');
    }

    const s3Key = this.getS3Key(bucket, key);

    try {
      const command = new HeadObjectCommand({
        Bucket: this.s3Bucket,
        Key: s3Key,
      });
      const response = await this.s3Client.send(command);
      return { exists: true, size: response.ContentLength };
    } catch {
      return { exists: false };
    }
  }

  // ==========================================================================
  // S3 Protocol extensions
  // ==========================================================================

  async putObjectStream(
    bucket: string,
    key: string,
    body: Readable,
    opts: { contentType?: string; contentLength?: number }
  ): Promise<{ etag: string; size: number }> {
    if (!this.s3Client) {
      throw new Error('S3 client not initialized');
    }
    const s3Key = this.getS3Key(bucket, key);
    const resp = await this.s3Client.send(
      new PutObjectCommand({
        Bucket: this.s3Bucket,
        Key: s3Key,
        Body: body,
        ContentType: opts.contentType,
        ContentLength: opts.contentLength,
      })
    );
    return { etag: stripEtagQuotes(resp.ETag), size: opts.contentLength ?? 0 };
  }

  async getObjectStream(
    bucket: string,
    key: string,
    opts?: { range?: string }
  ): Promise<GetObjectResult> {
    if (!this.s3Client) {
      throw new Error('S3 client not initialized');
    }
    const branchKey = this.getS3Key(bucket, key);
    const parentKey = this.getParentS3Key(bucket, key);
    const range = opts?.range;
    const result = await this.withFallback(
      branchKey,
      parentKey,
      async (s3Key) => this.tryGetObjectStream(s3Key, range),
    );
    if (!result) {
      // Preserve previous behaviour: missing object surfaces as a thrown
      // error here (callers expect a stream, not null).
      throw new Error('GetObject returned empty body');
    }
    return result;
  }

  private async tryGetObjectStream(
    s3Key: string,
    range: string | undefined,
  ): Promise<GetObjectResult | null> {
    try {
      const resp = await this.s3Client!.send(
        new GetObjectCommand({ Bucket: this.s3Bucket, Key: s3Key, Range: range })
      );
      if (!resp.Body) return null;
      return {
        body: resp.Body as Readable,
        size: Number(resp.ContentLength ?? 0),
        etag: stripEtagQuotes(resp.ETag),
        contentType: resp.ContentType,
        lastModified: resp.LastModified ?? new Date(),
      };
    } catch (err) {
      if (isS3NotFound(err)) return null;
      throw err;
    }
  }

  async headObject(bucket: string, key: string): Promise<ObjectMetadata | null> {
    if (!this.s3Client) {
      throw new Error('S3 client not initialized');
    }
    return this.withFallback(
      this.getS3Key(bucket, key),
      this.getParentS3Key(bucket, key),
      async (s3Key) => this.tryHeadObject(s3Key),
    );
  }

  private async tryHeadObject(s3Key: string): Promise<ObjectMetadata | null> {
    try {
      const resp = await this.s3Client!.send(
        new HeadObjectCommand({ Bucket: this.s3Bucket, Key: s3Key })
      );
      return {
        size: Number(resp.ContentLength ?? 0),
        etag: stripEtagQuotes(resp.ETag),
        contentType: resp.ContentType,
        lastModified: resp.LastModified ?? new Date(),
      };
    } catch (err: unknown) {
      if (isS3NotFound(err)) {
        return null;
      }
      throw err;
    }
  }

  async copyObject(
    srcBucket: string,
    srcKey: string,
    dstBucket: string,
    dstKey: string
  ): Promise<{ etag: string; lastModified: Date }> {
    if (!this.s3Client) {
      throw new Error('S3 client not initialized');
    }
    // CopySource must be `<bucket>/<key>` with forward slashes preserved.
    // Encoding the whole key with encodeURIComponent turns '/' into '%2F' and
    // S3 then fails to resolve the source. Encode each segment individually.
    const encodedKey = this.getS3Key(srcBucket, srcKey)
      .split('/')
      .map((seg) => encodeURIComponent(seg))
      .join('/');
    const source = `${this.s3Bucket}/${encodedKey}`;
    const resp = await this.s3Client.send(
      new CopyObjectCommand({
        Bucket: this.s3Bucket,
        Key: this.getS3Key(dstBucket, dstKey),
        CopySource: source,
      })
    );
    return {
      etag: stripEtagQuotes(resp.CopyObjectResult?.ETag),
      lastModified: resp.CopyObjectResult?.LastModified ?? new Date(),
    };
  }

  async createMultipartUpload(
    bucket: string,
    key: string,
    opts: { contentType?: string }
  ): Promise<{ uploadId: string }> {
    if (!this.s3Client) {
      throw new Error('S3 client not initialized');
    }
    const resp = await this.s3Client.send(
      new CreateMultipartUploadCommand({
        Bucket: this.s3Bucket,
        Key: this.getS3Key(bucket, key),
        ContentType: opts.contentType,
      })
    );
    if (!resp.UploadId) {
      throw new Error('CreateMultipartUpload returned no UploadId');
    }
    return { uploadId: resp.UploadId };
  }

  async uploadPart(
    bucket: string,
    key: string,
    uploadId: string,
    partNumber: number,
    body: Readable,
    contentLength: number
  ): Promise<{ etag: string }> {
    if (!this.s3Client) {
      throw new Error('S3 client not initialized');
    }
    const resp = await this.s3Client.send(
      new UploadPartCommand({
        Bucket: this.s3Bucket,
        Key: this.getS3Key(bucket, key),
        UploadId: uploadId,
        PartNumber: partNumber,
        Body: body,
        ContentLength: contentLength,
      })
    );
    return { etag: stripEtagQuotes(resp.ETag) };
  }

  async completeMultipartUpload(
    bucket: string,
    key: string,
    uploadId: string,
    parts: Array<{ partNumber: number; etag: string }>
  ): Promise<{ etag: string; size: number }> {
    if (!this.s3Client) {
      throw new Error('S3 client not initialized');
    }
    const resp = await this.s3Client.send(
      new CompleteMultipartUploadCommand({
        Bucket: this.s3Bucket,
        Key: this.getS3Key(bucket, key),
        UploadId: uploadId,
        MultipartUpload: {
          Parts: parts.map((p) => ({ ETag: `"${p.etag}"`, PartNumber: p.partNumber })),
        },
      })
    );
    // After S3 successfully completes the multipart upload, the object must
    // be head-able. If it isn't, something is wrong with the backend or we're
    // looking at consistency lag — either way, returning size:0 would corrupt
    // storage.objects metadata. Fail fast instead.
    const head = await this.headObject(bucket, key);
    if (!head) {
      throw new Error(
        `CompleteMultipartUpload succeeded but HEAD returned null for ${bucket}/${key}`
      );
    }
    return { etag: stripEtagQuotes(resp.ETag), size: head.size };
  }

  async abortMultipartUpload(bucket: string, key: string, uploadId: string): Promise<void> {
    if (!this.s3Client) {
      throw new Error('S3 client not initialized');
    }
    await this.s3Client.send(
      new AbortMultipartUploadCommand({
        Bucket: this.s3Bucket,
        Key: this.getS3Key(bucket, key),
        UploadId: uploadId,
      })
    );
  }

  async listParts(
    bucket: string,
    key: string,
    uploadId: string,
    opts: { maxParts?: number; partNumberMarker?: number }
  ): Promise<{
    parts: Array<{ partNumber: number; etag: string; size: number; lastModified: Date }>;
    isTruncated: boolean;
    nextPartNumberMarker?: number;
  }> {
    if (!this.s3Client) {
      throw new Error('S3 client not initialized');
    }
    const resp = await this.s3Client.send(
      new ListPartsCommand({
        Bucket: this.s3Bucket,
        Key: this.getS3Key(bucket, key),
        UploadId: uploadId,
        MaxParts: opts.maxParts,
        PartNumberMarker:
          opts.partNumberMarker !== undefined && opts.partNumberMarker !== null
            ? String(opts.partNumberMarker)
            : undefined,
      })
    );
    return {
      parts: (resp.Parts ?? []).map((p) => ({
        partNumber: p.PartNumber ?? 0,
        etag: stripEtagQuotes(p.ETag),
        size: Number(p.Size ?? 0),
        lastModified: p.LastModified ?? new Date(),
      })),
      isTruncated: !!resp.IsTruncated,
      nextPartNumberMarker: resp.NextPartNumberMarker
        ? Number(resp.NextPartNumberMarker)
        : undefined,
    };
  }
}
