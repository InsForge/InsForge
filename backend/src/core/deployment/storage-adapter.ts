/**
 * Storage adapter for deployments
 * S3-based storage for static site deployments
 */

import path from 'path';
import {
  S3Client,
  PutObjectCommand,
  ListObjectsV2Command,
  DeleteObjectsCommand,
} from '@aws-sdk/client-s3';
import { logger } from '@/utils/logger.js';

const DEFAULT_AWS_REGION = 'us-east-1';

export interface DeploymentFile {
  path: string;
  content: string | Buffer;
}

export interface StorageAdapter {
  deploy(deploymentId: string, files: DeploymentFile[], subdomain?: string): Promise<string>;
  delete(deploymentId: string, subdomain?: string): Promise<void>;
}

/**
 * S3 storage adapter for deployments
 */
export class S3StorageAdapter implements StorageAdapter {
  private s3Client: S3Client;
  private bucket: string;

  constructor() {
    const bucket = process.env.AWS_DEPLOYMENT_S3_BUCKET;
    if (!bucket) {
      throw new Error('AWS_DEPLOYMENT_S3_BUCKET environment variable is required for S3 storage');
    }

    this.bucket = bucket;

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
    try {
      // Upload all files to S3 under subdomain path
      const uploadPromises = files.map(async (file) => {
        const s3Key = `${subdomain}/${file.path}`;
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

      logger.info('S3 deployment successful', { deploymentId, subdomain, fileCount: files.length });

      // AWS_CLOUDFRONT_DOMAIN is required for deployments
      const cloudFrontDomain = process.env.AWS_CLOUDFRONT_DOMAIN;

      if (!cloudFrontDomain) {
        throw new Error(
          'AWS_CLOUDFRONT_DOMAIN environment variable is required for site deployments'
        );
      }

      // Return URL with subdomain
      return `https://${subdomain}.${cloudFrontDomain}`;
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
      // Delete all objects under subdomain prefix
      const prefix = `${subdomain}/`;

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
 * Factory function to get S3 storage adapter
 * AWS_DEPLOYMENT_S3_BUCKET is required for deployments
 */
export function getStorageAdapter(): StorageAdapter {
  return new S3StorageAdapter();
}
