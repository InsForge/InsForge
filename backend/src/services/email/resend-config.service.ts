import { Pool, PoolClient } from 'pg';
import { Resend } from 'resend';
import { DatabaseManager } from '@/infra/database/database.manager.js';
import { EncryptionManager } from '@/infra/security/encryption.manager.js';
import { AppError } from '@/utils/errors.js';
import logger from '@/utils/logger.js';
import {
  ERROR_CODES,
  type ResendConfigSchema,
  type UpsertResendConfigRequest,
} from '@insforge/shared-schemas';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const RESEND_CONFIG_COLUMNS = `
  id, enabled, api_key_encrypted,
  sender_email as "senderEmail", sender_name as "senderName",
  created_at as "createdAt", updated_at as "updatedAt"`;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function toISOString(value: unknown): string {
  if (value instanceof Date) {
    return value.toISOString();
  }
  if (typeof value === 'string') {
    return value;
  }
  return new Date().toISOString();
}

function toResendConfigSchema(row: Record<string, unknown>): ResendConfigSchema {
  return {
    id: row.id as string,
    enabled: row.enabled as boolean,
    hasApiKey: !!row.api_key_encrypted,
    senderEmail: row.senderEmail as string,
    senderName: row.senderName as string,
    createdAt: toISOString(row.createdAt),
    updatedAt: toISOString(row.updatedAt),
  };
}

const EMPTY_CONFIG: ResendConfigSchema = {
  id: '00000000-0000-0000-0000-000000000000',
  enabled: false,
  hasApiKey: false,
  senderEmail: '',
  senderName: '',
  createdAt: '',
  updatedAt: '',
};

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface RawResendConfig {
  id: string;
  enabled: boolean;
  apiKey: string;
  senderEmail: string;
  senderName: string;
}

// ---------------------------------------------------------------------------
// Service
// ---------------------------------------------------------------------------

export class ResendConfigService {
  private static instance: ResendConfigService;
  private pool: Pool | null = null;

  private constructor() {
    logger.info('ResendConfigService initialized');
  }

  public static getInstance(): ResendConfigService {
    if (!ResendConfigService.instance) {
      ResendConfigService.instance = new ResendConfigService();
    }
    return ResendConfigService.instance;
  }

  private getPool(): Pool {
    if (!this.pool) {
      this.pool = DatabaseManager.getInstance().getPool();
    }
    return this.pool;
  }

  private getDecryptedApiKey(apiKeyEncrypted: string): string | null {
    if (!apiKeyEncrypted) {
      return null;
    }
    try {
      return EncryptionManager.decrypt(apiKeyEncrypted);
    } catch (error) {
      logger.error('Failed to decrypt Resend API key — credentials may be corrupted', { error });
      return null;
    }
  }

  // -------------------------------------------------------------------------
  // Reads
  // -------------------------------------------------------------------------

  async getResendConfig(): Promise<ResendConfigSchema> {
    try {
      const result = await this.getPool().query(
        `SELECT ${RESEND_CONFIG_COLUMNS} FROM email.resend_config LIMIT 1`
      );
      if (!result.rows.length) {
        const now = new Date().toISOString();
        return { ...EMPTY_CONFIG, createdAt: now, updatedAt: now };
      }
      return toResendConfigSchema(result.rows[0]);
    } catch (error) {
      logger.error('Failed to get Resend config', { error });
      throw new AppError('Failed to get Resend configuration', 500, ERROR_CODES.INTERNAL_ERROR);
    }
  }

  async getRawResendConfig(): Promise<RawResendConfig | null> {
    const result = await this.getPool().query(
      `SELECT ${RESEND_CONFIG_COLUMNS} FROM email.resend_config LIMIT 1`
    );
    if (!result.rows.length) {
      return null;
    }

    const row = result.rows[0];
    if (!row.enabled) {
      return null;
    }

    const apiKey = this.getDecryptedApiKey(row.api_key_encrypted);
    if (apiKey === null) {
      throw new AppError(
        'Resend API key is corrupted — cannot decrypt stored credentials',
        500,
        ERROR_CODES.EMAIL_RESEND_CONNECTION_FAILED
      );
    }

    return {
      id: row.id,
      enabled: row.enabled,
      apiKey,
      senderEmail: row.senderEmail,
      senderName: row.senderName,
    };
  }

  // -------------------------------------------------------------------------
  // Write
  // -------------------------------------------------------------------------

  async upsertResendConfig(input: UpsertResendConfigRequest): Promise<ResendConfigSchema> {
    // Verify outside the transaction to avoid holding a DB connection and row lock
    // during the external HTTP call to Resend.
    if (input.enabled) {
      const existing = await this.getPool().query(
        'SELECT api_key_encrypted FROM email.resend_config LIMIT 1'
      );
      const existingEncrypted: string = existing.rows[0]?.api_key_encrypted ?? '';
      await this.verifyResendConnection(input, existingEncrypted);
    }

    const client = await this.getPool().connect();
    try {
      await client.query('BEGIN');

      const existingRow = await this.lockOrCreateSingletonRow(client);

      let apiKeyEncrypted = existingRow.api_key_encrypted;
      if (input.apiKey) {
        apiKeyEncrypted = EncryptionManager.encrypt(input.apiKey);
      }

      const result = await client.query(
        `UPDATE email.resend_config SET
           enabled = $1, api_key_encrypted = $2,
           sender_email = COALESCE($3, sender_email),
           sender_name = COALESCE($4, sender_name),
           updated_at = NOW()
         WHERE id = $5
         RETURNING ${RESEND_CONFIG_COLUMNS}`,
        [
          input.enabled,
          apiKeyEncrypted,
          input.senderEmail ?? null,
          input.senderName ?? null,
          existingRow.id,
        ]
      );

      await client.query('COMMIT');
      logger.info('Resend config updated', { enabled: input.enabled });

      return toResendConfigSchema(result.rows[0]);
    } catch (error) {
      await client.query('ROLLBACK');
      logger.error('Failed to upsert Resend config', { error });
      if (error instanceof AppError) {
        throw error;
      }
      throw new AppError('Failed to update Resend configuration', 500, ERROR_CODES.INTERNAL_ERROR);
    } finally {
      client.release();
    }
  }

  // -------------------------------------------------------------------------
  // Private helpers
  // -------------------------------------------------------------------------

  private async lockOrCreateSingletonRow(
    client: PoolClient
  ): Promise<{ id: string; api_key_encrypted: string }> {
    let result = await client.query(
      'SELECT id, api_key_encrypted FROM email.resend_config LIMIT 1 FOR UPDATE'
    );

    if (!result.rows.length) {
      const insertResult = await client.query(
        `INSERT INTO email.resend_config DEFAULT VALUES
         ON CONFLICT DO NOTHING
         RETURNING id, api_key_encrypted`
      );

      if (insertResult.rows.length) {
        result = insertResult;
      } else {
        result = await client.query(
          'SELECT id, api_key_encrypted FROM email.resend_config LIMIT 1 FOR UPDATE'
        );
      }
    }

    if (!result.rows.length) {
      throw new AppError(
        'Failed to initialize Resend configuration',
        500,
        ERROR_CODES.INTERNAL_ERROR
      );
    }

    return result.rows[0];
  }

  private async verifyResendConnection(
    input: UpsertResendConfigRequest,
    existingApiKeyEncrypted: string
  ): Promise<void> {
    let apiKey: string;

    if (input.apiKey) {
      apiKey = input.apiKey;
    } else if (!existingApiKeyEncrypted) {
      throw new AppError(
        'Resend API key is required when enabling Resend',
        400,
        ERROR_CODES.INVALID_INPUT
      );
    } else {
      const decrypted = this.getDecryptedApiKey(existingApiKeyEncrypted);
      if (decrypted === null) {
        throw new AppError(
          'Resend API key is corrupted — cannot decrypt stored credentials',
          500,
          ERROR_CODES.EMAIL_RESEND_CONNECTION_FAILED
        );
      }
      apiKey = decrypted;
    }

    try {
      const resend = new Resend(apiKey);
      // Use a test send to delivered@resend.dev — works with both full_access and
      // sending_access keys, unlike apiKeys.list() which requires full_access.
      const { error } = await resend.emails.send({
        from: 'onboarding@resend.dev',
        to: ['delivered@resend.dev'],
        subject: 'API Key Verification',
        text: 'Testing Resend configuration.',
      });
      if (error) {
        throw new Error(error.message);
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown connection error';
      logger.error('Resend API key verification failed', { error: message });
      throw new AppError(
        `Resend API key verification failed: ${message}`,
        400,
        ERROR_CODES.EMAIL_RESEND_CONNECTION_FAILED
      );
    }
  }
}
