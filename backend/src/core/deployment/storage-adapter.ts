/**
 * Storage adapter for deployments
 * Provides unified interface for local and S3 storage
 */

import fs from 'fs/promises';
import path from 'path';
import { S3Client, PutObjectCommand, DeleteObjectCommand } from '@aws-sdk/client-s3';
import logger from '@/utils/logger.js';

export interface DeploymentFile {
  path: string;
  content: string | Buffer;
}

export interface StorageAdapter {
  deploy(deploymentId: string, files: DeploymentFile[]): Promise<string>;
  delete(deploymentId: string): Promise<void>;
}

/**
 * Local filesystem storage adapter
 */
export class LocalStorageAdapter implements StorageAdapter {
  private baseDir: string;

  constructor(baseDir?: string) {
    this.baseDir = baseDir || process.env.STORAGE_DIR || '/insforge-storage/deployments';
  }

  async deploy(deploymentId: string, files: DeploymentFile[]): Promise<string> {
    const deployPath = path.join(this.baseDir, deploymentId);

    try {
      // Create deployment directory
      await fs.mkdir(deployPath, { recursive: true });

      // Write all files
      for (const file of files) {
        const filePath = path.join(deployPath, file.path);
        await fs.mkdir(path.dirname(filePath), { recursive: true });
        await fs.writeFile(filePath, file.content);
      }

      logger.info('Local deployment successful', { deploymentId, fileCount: files.length });

      // Return local URL
      const baseUrl = process.env.DEPLOYMENT_BASE_URL || 'http://localhost:8080/deployments';
      return `${baseUrl}/${deploymentId}/`;
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

  async delete(deploymentId: string): Promise<void> {
    const deployPath = path.join(this.baseDir, deploymentId);

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
      region: process.env.AWS_REGION || 'us-east-2',
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

  async deploy(deploymentId: string, files: DeploymentFile[]): Promise<string> {
    try {
      // Upload all files to S3
      const uploadPromises = files.map(async (file) => {
        const s3Key = this.getS3Key(deploymentId, file.path);
        const command = new PutObjectCommand({
          Bucket: this.bucket,
          Key: s3Key,
          Body: file.content,
          ContentType: this.getContentType(file.path),
          CacheControl: 'public, max-age=31536000',
        });

        await this.s3Client.send(command);
      });

      await Promise.all(uploadPromises);

      logger.info('S3 deployment successful', { deploymentId, fileCount: files.length });

      // Return CloudFront URL if available
      const cloudFrontUrl = process.env.AWS_CLOUDFRONT_URL;
      if (cloudFrontUrl) {
        return `${cloudFrontUrl}/${this.appKey}/deployments/${deploymentId}/index.html`;
      }

      // Fallback to S3 URL (must include index.html since S3 doesn't support directory indexes)
      const region = process.env.AWS_REGION || 'us-east-1';
      return `https://${this.bucket}.s3.${region}.amazonaws.com/${this.appKey}/deployments/${deploymentId}/index.html`;
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

  async delete(deploymentId: string): Promise<void> {
    try {
      const s3Key = this.getS3Key(deploymentId, 'index.html');
      const command = new DeleteObjectCommand({
        Bucket: this.bucket,
        Key: s3Key,
      });

      await this.s3Client.send(command);
      logger.info('S3 deployment deleted', { deploymentId });
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
 */
export function getStorageAdapter(): StorageAdapter {
  const backend = process.env.AWS_S3_BUCKET ? 's3' : 'local';

  if (backend === 's3') {
    return new S3StorageAdapter();
  }

  return new LocalStorageAdapter();
}
