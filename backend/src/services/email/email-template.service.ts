import { Pool } from 'pg';
import { DatabaseManager } from '@/infra/database/database.manager.js';
import { AppError } from '@/utils/errors.js';
import logger from '@/utils/logger.js';
import {
  ERROR_CODES,
  type EmailTemplateSchema,
  type UpdateEmailTemplateRequest,
} from '@insforge/shared-schemas';

/**
 * Normalize a pg timestamp value to an ISO string
 */
function toISOString(value: unknown): string {
  if (value instanceof Date) {
    return value.toISOString();
  }
  if (typeof value === 'string') {
    return value;
  }
  return new Date().toISOString();
}

function normalizeTemplateRow(row: Record<string, unknown>): EmailTemplateSchema {
  return {
    id: row.id as string,
    templateType: row.templateType as string,
    subject: row.subject as string,
    bodyHtml: row.bodyHtml as string,
    createdAt: toISOString(row.createdAt),
    updatedAt: toISOString(row.updatedAt),
  };
}

export class EmailTemplateService {
  private static instance: EmailTemplateService;
  private pool: Pool | null = null;

  private constructor() {
    logger.info('EmailTemplateService initialized');
  }

  public static getInstance(): EmailTemplateService {
    if (!EmailTemplateService.instance) {
      EmailTemplateService.instance = new EmailTemplateService();
    }
    return EmailTemplateService.instance;
  }

  private getPool(): Pool {
    if (!this.pool) {
      this.pool = DatabaseManager.getInstance().getPool();
    }
    return this.pool;
  }

  /**
   * Get all email templates ordered by template_type
   */
  async getTemplates(providerType: string = 'custom_smtp'): Promise<EmailTemplateSchema[]> {
    try {
      const result = await this.getPool().query(
        `SELECT
          id,
          template_type as "templateType",
          subject,
          body_html as "bodyHtml",
          created_at as "createdAt",
          updated_at as "updatedAt"
         FROM email.templates
         WHERE provider_type = $1
         ORDER BY template_type`,
        [providerType]
      );

      return result.rows.map(normalizeTemplateRow);
    } catch (error) {
      logger.error('Failed to get email templates', { error });
      throw new AppError('Failed to get email templates', 500, ERROR_CODES.INTERNAL_ERROR);
    }
  }

  /**
   * Get a single email template by type
   * Throws 404 if not found
   */
  async getTemplate(templateType: string, providerType: string = 'custom_smtp'): Promise<EmailTemplateSchema> {
    try {
      const result = await this.getPool().query(
        `SELECT
          id,
          template_type as "templateType",
          subject,
          body_html as "bodyHtml",
          created_at as "createdAt",
          updated_at as "updatedAt"
         FROM email.templates
         WHERE template_type = $1 AND provider_type = $2`,
        [templateType, providerType]
      );

      if (!result.rows.length) {
        throw new AppError(
          `Email template not found: ${templateType}`,
          404,
          ERROR_CODES.EMAIL_TEMPLATE_NOT_FOUND
        );
      }

      return normalizeTemplateRow(result.rows[0]);
    } catch (error) {
      if (error instanceof AppError) {
        throw error;
      }
      logger.error('Failed to get email template', { templateType, error });
      throw new AppError('Failed to get email template', 500, ERROR_CODES.INTERNAL_ERROR);
    }
  }

  /**
   * Update an email template's subject and body_html
   */
  async updateTemplate(
    templateType: string,
    input: UpdateEmailTemplateRequest,
    providerType: string = 'custom_smtp'
  ): Promise<EmailTemplateSchema> {
    try {
      const result = await this.getPool().query(
        `UPDATE email.templates
         SET
           subject = $1,
           body_html = $2,
           updated_at = NOW()
         WHERE template_type = $3 AND provider_type = $4
         RETURNING
           id,
           template_type as "templateType",
           subject,
           body_html as "bodyHtml",
           created_at as "createdAt",
           updated_at as "updatedAt"`,
        [input.subject, input.bodyHtml, templateType, providerType]
      );

      if (!result.rows.length) {
        throw new AppError(
          `Email template not found: ${templateType}`,
          404,
          ERROR_CODES.EMAIL_TEMPLATE_NOT_FOUND
        );
      }

      logger.info('Email template updated', { templateType });
      return normalizeTemplateRow(result.rows[0]);
    } catch (error) {
      if (error instanceof AppError) {
        throw error;
      }
      logger.error('Failed to update email template', { templateType, error });
      throw new AppError('Failed to update email template', 500, ERROR_CODES.INTERNAL_ERROR);
    }
  }
}
