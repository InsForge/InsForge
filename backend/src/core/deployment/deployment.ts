/**
 * Deployment service
 * Handles deployment lifecycle
 */

import { randomUUID } from 'crypto';
import { DatabaseManager } from '@/core/database/manager.js';
import { getStorageAdapter, DeploymentFile } from './storage-adapter.js';
import { logger } from '@/utils/logger.js';

export interface CreateDeploymentRequest {
  projectName: string;
  files: DeploymentFile[];
}

export interface Deployment {
  id: string;
  projectName: string;
  subdomain: string;
  status: string;
  deploymentUrl: string | null;
  createdAt: string;
  deployedAt: string | null;
  updatedAt: string;
}

export class DeploymentService {
  private static instance: DeploymentService;
  private db;
  private storageAdapter;

  private constructor() {
    this.db = DatabaseManager.getInstance().getDb();
    this.storageAdapter = getStorageAdapter();
  }

  static getInstance(): DeploymentService {
    if (!DeploymentService.instance) {
      DeploymentService.instance = new DeploymentService();
    }
    return DeploymentService.instance;
  }

  /**
   * Create and deploy a new deployment
   */
  async createDeployment(request: CreateDeploymentRequest): Promise<Deployment> {
    const { projectName, files } = request;

    // Check if deployment already exists
    const existing = await this.db.prepare('SELECT id FROM _deployments LIMIT 1').get();
    if (existing) {
      throw new Error(
        'Deployment already exists. Delete existing deployment before creating a new one.'
      );
    }

    // Validate files
    if (!files || files.length === 0) {
      throw new Error('No files provided for deployment');
    }

    // Sanitize and validate file paths
    for (const file of files) {
      // Disallow absolute paths
      if (file.path.startsWith('/')) {
        throw new Error(`Invalid file path: ${file.path} (absolute paths not allowed)`);
      }
      // Disallow path traversal
      if (file.path.includes('..')) {
        throw new Error(`Invalid file path: ${file.path} (path traversal not allowed)`);
      }
      // Disallow empty paths
      if (!file.path.trim()) {
        throw new Error('File path cannot be empty');
      }
    }

    // Ensure index.html exists
    const hasIndexHtml = files.some((f) => f.path === 'index.html');
    if (!hasIndexHtml) {
      throw new Error('Deployment must include an index.html file');
    }

    let deploymentId: string | undefined;
    try {
      // Generate deployment ID
      deploymentId = randomUUID();

      // Generate subdomain (simple slug from project name)
      const subdomain = this.generateSubdomain(projectName, deploymentId);

      // Create database record
      await this.db
        .prepare(
          `INSERT INTO _deployments (id, project_name, subdomain, status)
           VALUES (?, ?, ?, ?)`
        )
        .run(deploymentId, projectName, subdomain, 'deploying');

      logger.info('Deployment record created', { deploymentId, projectName });

      // Decode base64 content if needed
      const decodedFiles = files.map((file) => ({
        path: file.path,
        content:
          typeof file.content === 'string' && this.isBase64(file.content)
            ? Buffer.from(file.content, 'base64')
            : file.content,
      }));

      // Deploy files to storage
      const deploymentUrl = await this.storageAdapter.deploy(deploymentId, decodedFiles);

      // Update deployment status
      await this.db
        .prepare(
          `UPDATE _deployments 
           SET status = ?, deployment_url = ?, deployed_at = CURRENT_TIMESTAMP, storage_path = ?
           WHERE id = ?`
        )
        .run('active', deploymentUrl, `deployments/${deploymentId}`, deploymentId);

      logger.info('Deployment successful', { deploymentId, url: deploymentUrl });

      // Return deployment info
      return this.getDeployment();
    } catch (error) {
      logger.error('Deployment failed', {
        projectName,
        error: error instanceof Error ? error.message : String(error),
      });
      // Set status to 'failed' if deployment was created
      if (deploymentId) {
        try {
          await this.db
            .prepare(`UPDATE _deployments SET status = ?, deployed_at = NULL WHERE id = ?`)
            .run('failed', deploymentId);
        } catch {
          // best-effort; swallow to not mask original error
        }
      }
      throw error;
    }
  }

  /**
   * Get the single deployment
   */
  async getDeployment(): Promise<Deployment> {
    const result = await this.db
      .prepare(
        `SELECT id, project_name as projectName, subdomain, status, deployment_url as deploymentUrl,
                created_at as createdAt, deployed_at as deployedAt, updated_at as updatedAt
         FROM _deployments
         LIMIT 1`
      )
      .get();

    if (!result) {
      throw new Error('No deployment found');
    }

    return result as Deployment;
  }

  /**
   * Delete the deployment
   */
  async deleteDeployment(): Promise<void> {
    // Get deployment
    const deployment = await this.db.prepare('SELECT id FROM _deployments LIMIT 1').get();

    if (!deployment) {
      throw new Error('No deployment found');
    }

    const id = deployment.id;

    try {
      // Delete from storage
      await this.storageAdapter.delete(id);

      // Delete from database
      await this.db.prepare('DELETE FROM _deployments').run();

      logger.info('Deployment deleted', { deploymentId: id });
    } catch (error) {
      logger.error('Failed to delete deployment', {
        deploymentId: id,
        error: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }
  }

  /**
   * Generate subdomain from project name
   */
  private generateSubdomain(projectName: string, deploymentId: string): string {
    // Sanitize project name
    const sanitized = projectName
      .toLowerCase()
      .replace(/[^a-z0-9-]/g, '-')
      .replace(/-+/g, '-')
      .substring(0, 32);

    // Add short ID suffix for uniqueness
    const shortId = deploymentId.substring(0, 8);

    return `${sanitized}-${shortId}`;
  }

  /**
   * Check if string is base64 encoded
   */
  private isBase64(str: string): boolean {
    try {
      return Buffer.from(str, 'base64').toString('base64') === str;
    } catch {
      return false;
    }
  }
}
