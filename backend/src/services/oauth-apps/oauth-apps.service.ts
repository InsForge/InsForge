import { DatabaseManager } from '@/infra/database/database.manager.js';
import logger from '@/utils/logger.js';
import { Pool } from 'pg';
import crypto from 'crypto';

export interface OAuthApplication {
  id: string;
  name: string;
  website: string;
  icon_url: string | null;
  client_id: string;
  redirect_uris: string[];
  created_at: Date;
  updated_at: Date;
}

export interface OAuthAuthorization {
  id: string;
  app_id: string;
  project_id: string;
  user_id: string;
  scopes: string[];
  created_at: Date;
  oauth_applications?: Partial<OAuthApplication>;
}

export class OAuthAppsService {
  private static instance: OAuthAppsService;
  private pool: Pool | null = null;

  private constructor() {}

  static getInstance(): OAuthAppsService {
    if (!OAuthAppsService.instance) {
      OAuthAppsService.instance = new OAuthAppsService();
    }
    return OAuthAppsService.instance;
  }

  private getPool(): Pool {
    if (!this.pool) {
      const dbManager = DatabaseManager.getInstance();
      this.pool = dbManager.getPool();
    }
    return this.pool;
  }

  /**
   * Published Apps Operations
   */

  async createOAuthApp(data: {
    name: string;
    website: string;
    redirect_uris: string[];
  }): Promise<{ app: OAuthApplication; client_secret: string }> {
    try {
      const client_secret = crypto.randomBytes(32).toString('hex');
      // For PoC, simple hash
      const client_secret_hash = crypto.createHash('sha256').update(client_secret).digest('hex');

      const result = await this.getPool().query(
        `INSERT INTO public.oauth_applications (name, website, redirect_uris, client_secret_hash)
         VALUES ($1, $2, $3, $4)
         RETURNING id, name, website, icon_url, client_id, redirect_uris, created_at, updated_at`,
        [data.name, data.website, data.redirect_uris, client_secret_hash]
      );

      return { app: result.rows[0], client_secret };
    } catch (error) {
      logger.error('Failed to create OAuth App', { error });
      throw error;
    }
  }

  async listOAuthApps(): Promise<OAuthApplication[]> {
    try {
      const result = await this.getPool().query(
        `SELECT id, name, website, icon_url, client_id, redirect_uris, created_at, updated_at
         FROM public.oauth_applications
         ORDER BY created_at DESC`
      );
      return result.rows;
    } catch (error) {
      logger.error('Failed to list OAuth Apps', { error });
      throw error;
    }
  }

  async deleteOAuthApp(appId: string): Promise<boolean> {
    try {
      const result = await this.getPool().query(
        `DELETE FROM public.oauth_applications WHERE id = $1`,
        [appId]
      );
      return result.rowCount !== null && result.rowCount > 0;
    } catch (error) {
      logger.error('Failed to delete OAuth App', { error });
      throw error;
    }
  }

  /**
   * Authorized Apps Operations
   */

  async listAuthorizedApps(projectId: string): Promise<OAuthAuthorization[]> {
    try {
      // In a real app we'd join with user details. For PoC, just fetch the auth and app details.
      const result = await this.getPool().query(
        `SELECT 
           a.id, a.app_id, a.project_id, a.user_id, a.scopes, a.created_at,
           json_build_object(
             'name', app.name,
             'website', app.website,
             'client_id', app.client_id
           ) as oauth_applications
         FROM public.oauth_authorizations a
         JOIN public.oauth_applications app ON a.app_id = app.id
         WHERE a.project_id = $1
         ORDER BY a.created_at DESC`,
        [projectId]
      );
      return result.rows;
    } catch (error) {
      logger.error('Failed to list authorized Apps', { error });
      throw error;
    }
  }

  async revokeAuthorization(authId: string): Promise<boolean> {
    try {
      const result = await this.getPool().query(
        `DELETE FROM public.oauth_authorizations WHERE id = $1`,
        [authId]
      );
      return result.rowCount !== null && result.rowCount > 0;
    } catch (error) {
      logger.error('Failed to revoke OAuth App access', { error });
      throw error;
    }
  }
}
