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

    // Validate files
    if (!files || files.length === 0) {
      throw new Error('No files provided for deployment');
    }

    // Sanitize and validate file paths
    for (const file of files) {
      if (file.path.startsWith('/')) {
        throw new Error(`Invalid file path: ${file.path} (absolute paths not allowed)`);
      }
      if (file.path.includes('..')) {
        throw new Error(`Invalid file path: ${file.path} (path traversal not allowed)`);
      }
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
    let newSubdomain: string | undefined;
    
    try {
      // Generate deployment ID and subdomain
      deploymentId = randomUUID();
      newSubdomain = this.generateSubdomain(projectName, deploymentId);

      // Decode base64 content if needed
      const decodedFiles = files.map((file) => ({
        path: file.path,
        content:
          typeof file.content === 'string' && this.isBase64(file.content)
            ? Buffer.from(file.content, 'base64')
            : file.content,
      }));

      // Deploy files to storage FIRST (outside transaction)
      const deploymentUrl = await this.storageAdapter.deploy(deploymentId, decodedFiles, newSubdomain);
      logger.info('New deployment uploaded to storage', { deploymentId, url: deploymentUrl });

      // Now update database in transaction
      const pool = DatabaseManager.getInstance().getPool();
      const client = await pool.connect();
      
      let existing: { id: string; subdomain: string } | undefined;
      
      try {
        await client.query('BEGIN');

        // Lock existing deployment row for update
        const lockResult = await client.query(
          'SELECT id, subdomain FROM _deployments LIMIT 1 FOR UPDATE'
        );
        existing = lockResult.rows[0];

        if (existing) {
          // Update existing deployment record
          await client.query(
            `UPDATE _deployments 
             SET id = $1, project_name = $2, subdomain = $3, status = $4, deployment_url = $5, 
                 deployed_at = CURRENT_TIMESTAMP, storage_path = $6, updated_at = CURRENT_TIMESTAMP
             WHERE id = $7`,
            [deploymentId, projectName, newSubdomain, 'active', deploymentUrl, `deployments/${newSubdomain}`, existing.id]
          );
          logger.info('Deployment record updated', { oldId: existing.id, newId: deploymentId });
        } else {
          // Create new deployment record
          await client.query(
            `INSERT INTO _deployments (id, project_name, subdomain, status, deployment_url, deployed_at, storage_path)
             VALUES ($1, $2, $3, $4, $5, CURRENT_TIMESTAMP, $6)`,
            [deploymentId, projectName, newSubdomain, 'active', deploymentUrl, `deployments/${newSubdomain}`]
          );
          logger.info('Deployment record created', { deploymentId, projectName });
        }

        await client.query('COMMIT');
      } catch (dbError) {
        await client.query('ROLLBACK');
        throw dbError;
      } finally {
        client.release();
      }

      // Only delete old deployment AFTER transaction commits
      if (existing) {
        try {
          await this.storageAdapter.delete(existing.id, existing.subdomain);
          logger.info('Old deployment cleaned up', { oldId: existing.id });
        } catch (cleanupError) {
          logger.warn('Failed to cleanup old deployment', {
            oldId: existing.id,
            error: cleanupError instanceof Error ? cleanupError.message : String(cleanupError),
          });
        }
      }

      logger.info('Deployment successful', { deploymentId, url: deploymentUrl });
      return this.getDeployment();
      
    } catch (error) {
      logger.error('Deployment failed', {
        projectName,
        error: error instanceof Error ? error.message : String(error),
      });
      
      // Cleanup failed deployment from storage
      if (deploymentId && newSubdomain) {
        try {
          await this.storageAdapter.delete(deploymentId, newSubdomain);
          logger.info('Failed deployment cleaned up from storage', { deploymentId });
        } catch (cleanupError) {
          logger.warn('Failed to cleanup failed deployment', {
            deploymentId,
            error: cleanupError instanceof Error ? cleanupError.message : String(cleanupError),
          });
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
    const deployment = await this.db
      .prepare('SELECT id, subdomain FROM _deployments LIMIT 1')
      .get();

    if (!deployment) {
      throw new Error('No deployment found');
    }

    const { id, subdomain } = deployment;

    try {
      // Delete from storage (using subdomain as path identifier)
      await this.storageAdapter.delete(id, subdomain);

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
      .substring(0, 63) // Max subdomain length
      .replace(/^-+|-+$/g, ''); // Strip leading/trailing hyphens

    // Use sanitized name or fallback to deploy-{shortId}
    const subdomain = sanitized || `deploy-${deploymentId.substring(0, 8)}`;

    return subdomain;
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
