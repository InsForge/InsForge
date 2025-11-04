/**
 * Storage adapter for deployments
 * Provides unified interface for local and S3 storage
 */

import fs from 'fs/promises';
import path from 'path';
import {
  S3Client,
  PutObjectCommand,
  ListObjectsV2Command,
  DeleteObjectsCommand,
} from '@aws-sdk/client-s3';
import { logger } from '@/utils/logger.js';

const DEFAULT_AWS_REGION = 'us-east-1';
const RFC1123_LABEL_REGEX = /^[a-z0-9]([-a-z0-9]*[a-z0-9])?$/i;

export interface DeploymentFile {
  path: string;
  content: string | Buffer;
}

export interface StorageAdapter {
  deploy(deploymentId: string, files: DeploymentFile[], subdomain?: string): Promise<string>;
  delete(deploymentId: string, subdomain?: string): Promise<void>;
}

/**
 * Normalize subdomain to RFC1123 compliant label
 */
function normalizeSubdomain(subdomain: string, fallback: string): string {
  const normalized = subdomain
    .toLowerCase()
    .replace(/[^a-z0-9-]/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-+|-+$/g, '');

  const result = normalized || fallback;

  if (!RFC1123_LABEL_REGEX.test(result)) {
    throw new Error(`Invalid subdomain: ${subdomain} (normalized: ${result})`);
  }

  return result;
}

/**
 * Local filesystem storage adapter
 */
export class LocalStorageAdapter implements StorageAdapter {
  private baseDir: string;

  constructor(baseDir?: string) {
    this.baseDir = baseDir || process.env.STORAGE_DIR || '/insforge-storage/deployments';
  }

  async deploy(deploymentId: string, files: DeploymentFile[], subdomain?: string): Promise<string> {
    // Validate and normalize subdomain
    const pathIdentifier = subdomain ? normalizeSubdomain(subdomain, deploymentId) : deploymentId;
    const deployPath = path.join(this.baseDir, pathIdentifier);

    try {
      // Create deployment directory
      await fs.mkdir(deployPath, { recursive: true });

      // Write all files
      for (const file of files) {
        // Normalize and validate file path to prevent traversal
        const normalizedPath = file.path.replace(/^\/+/, ''); // Remove leading slashes
        const resolvedPath = path.resolve(deployPath, normalizedPath);
        const resolvedDeployPath = path.resolve(deployPath);

        // Ensure resolved path is within deployment directory
        if (!resolvedPath.startsWith(resolvedDeployPath + path.sep)) {
          logger.warn('Skipping file with invalid path', { file: file.path, deploymentId });
          continue;
        }

        await fs.mkdir(path.dirname(resolvedPath), { recursive: true });
        await fs.writeFile(resolvedPath, file.content);
      }

      logger.info('Local deployment successful', { deploymentId, fileCount: files.length });

      // Return subdomain-based URL
      const baseUrl = process.env.DEPLOYMENT_BASE_URL || 'http://localhost:8080';
      const host = baseUrl.replace(/^https?:\/\//, '');

      logger.info('Creating Local Deployment Url', `http://${pathIdentifier}.${host}`);
      return `http://${pathIdentifier}.${host}`;
    } catch (error) {
      logger.error('Local deployment failed', {
        deploymentId,
        error: error instanceof Error ? error.message : String(error),
      });
      throw new Error(
        `Failed to deploy locally: ${error instanceof Error ? error.message : String(error)}`
      );
    }
  }

  async delete(deploymentId: string, subdomain?: string): Promise<void> {
    // Use subdomain for path if provided, otherwise fall back to deploymentId
    const pathIdentifier = subdomain || deploymentId;
    const deployPath = path.join(this.baseDir, pathIdentifier);

    try {
      await fs.rm(deployPath, { recursive: true, force: true });
      logger.info('Local deployment deleted', { deploymentId });
    } catch (error) {
      logger.error('Failed to delete local deployment', {
        deploymentId,
        error: error instanceof Error ? error.message : String(error),
      });
      throw new Error(
        `Failed to delete deployment: ${error instanceof Error ? error.message : String(error)}`
      );
    }
  }
}

/**
 * S3 storage adapter
 */
export class S3StorageAdapter implements StorageAdapter {
  private s3Client: S3Client;
  private bucket: string;
  private appKey: string;

  constructor() {
    const bucket = process.env.AWS_S3_BUCKET;
    if (!bucket) {
      throw new Error('AWS_S3_BUCKET environment variable is required for S3 storage');
    }

    this.bucket = bucket;
    this.appKey = process.env.APP_KEY || 'local';

    // Initialize S3 client
    const s3Config: {
      region: string;
      credentials?: { accessKeyId: string; secretAccessKey: string };
    } = {
      region: process.env.AWS_REGION || DEFAULT_AWS_REGION,
    };

    // Use explicit credentials if provided, otherwise use IAM role
    if (process.env.AWS_ACCESS_KEY_ID && process.env.AWS_SECRET_ACCESS_KEY) {
      s3Config.credentials = {
        accessKeyId: process.env.AWS_ACCESS_KEY_ID,
        secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
      };
    }

    this.s3Client = new S3Client(s3Config);
  }

  private getS3Key(deploymentId: string, filePath: string): string {
    return `${this.appKey}/deployments/${deploymentId}/${filePath}`;
  }

  private getContentType(filePath: string): string {
    const ext = path.extname(filePath).toLowerCase();
    const contentTypes: Record<string, string> = {
      '.html': 'text/html',
      '.css': 'text/css',
      '.js': 'application/javascript',
      '.json': 'application/json',
      '.png': 'image/png',
      '.jpg': 'image/jpeg',
      '.jpeg': 'image/jpeg',
      '.gif': 'image/gif',
      '.svg': 'image/svg+xml',
      '.ico': 'image/x-icon',
      '.txt': 'text/plain',
    };
    return contentTypes[ext] || 'application/octet-stream';
  }

  async deploy(deploymentId: string, files: DeploymentFile[], subdomain?: string): Promise<string> {
    const region = process.env.AWS_REGION || DEFAULT_AWS_REGION;
    // Validate and normalize subdomain
    const pathIdentifier = subdomain ? normalizeSubdomain(subdomain, deploymentId) : deploymentId;

    try {
      // Upload all files to S3
      const uploadPromises = files.map(async (file) => {
        const s3Key = `${this.appKey}/deployments/${pathIdentifier}/${file.path}`;
        // Set no-cache for index.html, long cache for other assets
        const cacheControl = file.path === 'index.html' ? 'no-cache' : 'public, max-age=31536000';

        const command = new PutObjectCommand({
          Bucket: this.bucket,
          Key: s3Key,
          Body: file.content,
          ContentType: this.getContentType(file.path),
          CacheControl: cacheControl,
        });

        await this.s3Client.send(command);
      });

      await Promise.all(uploadPromises);

      logger.info('S3 deployment successful', { deploymentId, fileCount: files.length });

      // AWS_CLOUDFRONT_DOMAIN is required for deployments
      const cloudFrontDomain = process.env.AWS_CLOUDFRONT_DOMAIN;

    if (!cloudFrontDomain) {
        throw new Error('AWS_CLOUDFRONT_DOMAIN environment variable is required for site deployments');
      }

      return `https://${pathIdentifier}.${cloudFrontDomain}`;
    } catch (error) {
      logger.error('S3 deployment failed', {
        deploymentId,
        error: error instanceof Error ? error.message : String(error),
      });
      throw new Error(
        `Failed to deploy to S3: ${error instanceof Error ? error.message : String(error)}`
      );
    }
  }

  async delete(deploymentId: string, subdomain?: string): Promise<void> {
    try {
      // Use subdomain for prefix if provided, otherwise fall back to deploymentId
      const pathIdentifier = subdomain || deploymentId;
      // Get deployment prefix
      const prefix = `${this.appKey}/deployments/${pathIdentifier}/`;

      // List all objects under the deployment prefix
      const objectsToDelete: { Key: string }[] = [];
      let continuationToken: string | undefined;

      do {
        const listCommand = new ListObjectsV2Command({
          Bucket: this.bucket,
          Prefix: prefix,
          ContinuationToken: continuationToken,
        });

        const listResponse = await this.s3Client.send(listCommand);

        if (listResponse.Contents) {
          objectsToDelete.push(
            ...listResponse.Contents.filter((obj) => obj.Key).map((obj) => ({
              Key: obj.Key as string,
            }))
          );
        }

        continuationToken = listResponse.NextContinuationToken;
      } while (continuationToken);

      // Delete all objects in batches of 1000
      if (objectsToDelete.length > 0) {
        for (let i = 0; i < objectsToDelete.length; i += 1000) {
          const batch = objectsToDelete.slice(i, i + 1000);
          const deleteCommand = new DeleteObjectsCommand({
            Bucket: this.bucket,
            Delete: {
              Objects: batch,
              Quiet: true,
            },
          });

          await this.s3Client.send(deleteCommand);
        }
      }

      logger.info('S3 deployment deleted', { deploymentId, filesDeleted: objectsToDelete.length });
    } catch (error) {
      logger.error('Failed to delete S3 deployment', {
        deploymentId,
        error: error instanceof Error ? error.message : String(error),
      });
      throw new Error(
        `Failed to delete deployment: ${error instanceof Error ? error.message : String(error)}`
      );
    }
  }
}

/**
 * Factory function to get appropriate storage adapter
 * Priority: S3 (if bucket configured) > Local
 */
export function getStorageAdapter(): StorageAdapter {
  const bucket = process.env.AWS_S3_BUCKET;

  // Use S3 if bucket is configured
  if (bucket && bucket.trim()) {
    logger.info('Using S3 storage adapter');
    return new S3StorageAdapter();
  }

  // Fallback to local storage
  logger.info('Using local storage adapter');
  return new LocalStorageAdapter();
}
