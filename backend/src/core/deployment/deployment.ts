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
  userId?: string;
}

export interface Deployment {
  id: string;
  projectName: string;
  subdomain: string;
  status: string;
  deploymentUrl: string | null;
  createdAt: string;
  deployedAt: string | null;
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
    const { projectName, files, userId } = request;

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
          `INSERT INTO _deployments (id, project_name, subdomain, status, created_by)
           VALUES (?, ?, ?, ?, ?)`
        )
        .run(deploymentId, projectName, subdomain, 'deploying', userId || null);

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
        .run('active', deploymentUrl, deploymentId, deploymentId);

      logger.info('Deployment successful', { deploymentId, url: deploymentUrl });

      // Return deployment info
      return this.getDeployment(deploymentId);
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
   * Get deployment by ID
   */
  async getDeployment(id: string): Promise<Deployment> {
    const result = await this.db
      .prepare(
        `SELECT id, project_name as projectName, subdomain, status, deployment_url as deploymentUrl,
                created_at as createdAt, deployed_at as deployedAt
         FROM _deployments
         WHERE id = ?`
      )
      .get(id);

    if (!result) {
      throw new Error('Deployment not found');
    }

    return result as Deployment;
  }

  /**
   * List all deployments
   */
  async listDeployments(userId?: string): Promise<Deployment[]> {
    let query = `SELECT id, project_name as projectName, subdomain, status, deployment_url as deploymentUrl,
                        created_at as createdAt, deployed_at as deployedAt
                 FROM _deployments`;

    const params: string[] = [];

    if (userId) {
      query += ' WHERE created_by = ?';
      params.push(userId);
    }

    query += ' ORDER BY created_at DESC';

    const results = await this.db.prepare(query).all(...params);
    return results as Deployment[];
  }

  /**
   * Delete deployment
   */
  async deleteDeployment(id: string, userId?: string, isAdmin: boolean = false): Promise<void> {
    // Get deployment
    const deployment = await this.db
      .prepare('SELECT id, created_by FROM _deployments WHERE id = ?')
      .get(id);

    if (!deployment) {
      throw new Error('Deployment not found');
    }

    // Check permissions
    if (!isAdmin && userId && deployment.created_by !== userId) {
      throw new Error('Permission denied: You can only delete your own deployments');
    }

    try {
      // Delete from storage
      await this.storageAdapter.delete(id);

      // Delete from database
      await this.db.prepare('DELETE FROM _deployments WHERE id = ?').run(id);

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
