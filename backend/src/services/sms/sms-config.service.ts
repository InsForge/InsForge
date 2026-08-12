import { Pool, PoolClient } from 'pg';
import { DatabaseManager } from '@/infra/database/database.manager.js';
import { EncryptionManager } from '@/infra/security/encryption.manager.js';
import { TwilioSmsProvider } from '@/providers/sms/twilio.provider.js';
import { AppError } from '@/utils/errors.js';
import { isProduction } from '@/utils/environment.js';
import {
  ERROR_CODES,
  type SmsConfigSchema,
  type SmsProviderSchema,
  type UpsertSmsConfigRequest,
} from '@insforge/shared-schemas';
import logger from '@/utils/logger.js';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

// Distinct from the email provider lock id (1869573991) so SMS and SMTP
// config writes never serialize against each other.
const SMS_PROVIDER_CONFIGURATION_LOCK_ID = 1869573992;

const SMS_CONFIG_COLUMNS = `
  id, enabled, provider,
  account_sid as "accountSid", auth_token_encrypted,
  from_number as "fromNumber", messaging_service_sid as "messagingServiceSid",
  min_interval_seconds as "minIntervalSeconds",
  otp_message_template as "otpMessageTemplate",
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

/** Map a DB row to the public SmsConfigSchema (auth token masked) */
function toSmsConfigSchema(row: Record<string, unknown>): SmsConfigSchema {
  return {
    id: row.id as string,
    enabled: row.enabled as boolean,
    provider: row.provider as SmsProviderSchema,
    accountSid: row.accountSid as string,
    hasAuthToken: !!row.auth_token_encrypted,
    fromNumber: row.fromNumber as string,
    messagingServiceSid: row.messagingServiceSid as string,
    minIntervalSeconds: row.minIntervalSeconds as number,
    otpMessageTemplate: row.otpMessageTemplate as string,
    createdAt: toISOString(row.createdAt),
    updatedAt: toISOString(row.updatedAt),
  };
}

const EMPTY_CONFIG: SmsConfigSchema = {
  id: '00000000-0000-0000-0000-000000000000',
  enabled: false,
  provider: 'twilio',
  accountSid: '',
  hasAuthToken: false,
  fromNumber: '',
  messagingServiceSid: '',
  minIntervalSeconds: 60,
  otpMessageTemplate: 'Your verification code is {{ code }}. It expires in 5 minutes.',
  createdAt: '',
  updatedAt: '',
};

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface RawSmsConfig {
  id: string;
  enabled: boolean;
  provider: SmsProviderSchema;
  accountSid: string;
  authToken: string;
  fromNumber: string;
  messagingServiceSid: string;
  minIntervalSeconds: number;
  otpMessageTemplate: string;
}

// ---------------------------------------------------------------------------
// Service
// ---------------------------------------------------------------------------

export class SmsConfigService {
  private static instance: SmsConfigService;
  private pool: Pool | null = null;

  private constructor() {
    logger.info('SmsConfigService initialized');
  }

  public static getInstance(): SmsConfigService {
    if (!SmsConfigService.instance) {
      SmsConfigService.instance = new SmsConfigService();
    }
    return SmsConfigService.instance;
  }

  private getPool(): Pool {
    if (!this.pool) {
      this.pool = DatabaseManager.getInstance().getPool();
    }
    return this.pool;
  }

  private getDecryptedAuthToken(authTokenEncrypted: string): string | null {
    if (!authTokenEncrypted) {
      return null;
    }
    try {
      return EncryptionManager.decrypt(authTokenEncrypted);
    } catch (error) {
      logger.error('Failed to decrypt SMS auth token — credentials may be corrupted', { error });
      return null;
    }
  }

  // -------------------------------------------------------------------------
  // Reads
  // -------------------------------------------------------------------------

  async getSmsConfig(): Promise<SmsConfigSchema> {
    try {
      const result = await this.getPool().query(
        `SELECT ${SMS_CONFIG_COLUMNS} FROM sms.config LIMIT 1`
      );
      if (!result.rows.length) {
        const now = new Date().toISOString();
        return { ...EMPTY_CONFIG, createdAt: now, updatedAt: now };
      }
      return toSmsConfigSchema(result.rows[0]);
    } catch (error) {
      logger.error('Failed to get SMS config', { error });
      throw new AppError('Failed to get SMS configuration', 500, ERROR_CODES.INTERNAL_ERROR);
    }
  }

  /**
   * Config for actually sending: null when disabled or unusable. The console
   * provider needs no credentials; Twilio requires a decryptable auth token.
   */
  async getRawSmsConfig(): Promise<RawSmsConfig | null> {
    try {
      const result = await this.getPool().query(
        `SELECT ${SMS_CONFIG_COLUMNS} FROM sms.config LIMIT 1`
      );
      if (!result.rows.length) {
        return null;
      }

      const row = result.rows[0];
      if (!row.enabled) {
        return null;
      }

      let authToken = '';
      if (row.provider !== 'console') {
        const decrypted = this.getDecryptedAuthToken(row.auth_token_encrypted);
        if (decrypted === null) {
          logger.error('SMS config has undecryptable credentials — treating as unconfigured');
          return null;
        }
        authToken = decrypted;
      }

      return {
        id: row.id,
        enabled: row.enabled,
        provider: row.provider,
        accountSid: row.accountSid,
        authToken,
        fromNumber: row.fromNumber,
        messagingServiceSid: row.messagingServiceSid,
        minIntervalSeconds: row.minIntervalSeconds,
        otpMessageTemplate: row.otpMessageTemplate,
      };
    } catch (error) {
      logger.error('Failed to get raw SMS config', { error });
      return null;
    }
  }

  // -------------------------------------------------------------------------
  // Write
  // -------------------------------------------------------------------------

  async upsertSmsConfig(input: UpsertSmsConfigRequest): Promise<SmsConfigSchema> {
    const client = await this.getPool().connect();
    try {
      await client.query('BEGIN');

      await client.query('SELECT pg_advisory_xact_lock($1)', [SMS_PROVIDER_CONFIGURATION_LOCK_ID]);

      const existingRow = await this.lockOrCreateSingletonRow(client);

      let authTokenEncrypted = existingRow.auth_token_encrypted;
      if (input.authToken) {
        authTokenEncrypted = EncryptionManager.encrypt(input.authToken);
      }

      // Only verify credentials when enabling — when disabling, the user is
      // turning SMS off and the values aren't going to be used.
      if (input.enabled) {
        if (input.provider === 'console') {
          if (isProduction()) {
            throw new AppError(
              'The console SMS provider is disabled in production',
              400,
              ERROR_CODES.INVALID_INPUT
            );
          }
        } else {
          await this.verifyTwilioCredentials(input, existingRow.auth_token_encrypted);
        }
      }

      const result = await client.query(
        `UPDATE sms.config SET
           enabled = $1, provider = $2, account_sid = $3,
           auth_token_encrypted = $4, from_number = $5, messaging_service_sid = $6,
           min_interval_seconds = $7, otp_message_template = $8, updated_at = NOW()
         WHERE id = $9
         RETURNING ${SMS_CONFIG_COLUMNS}`,
        [
          input.enabled,
          input.provider,
          input.accountSid,
          authTokenEncrypted,
          input.fromNumber,
          input.messagingServiceSid,
          input.minIntervalSeconds ?? 60,
          input.otpMessageTemplate,
          existingRow.id,
        ]
      );

      await client.query('COMMIT');
      logger.info('SMS config updated', {
        enabled: input.enabled,
        provider: input.provider,
      });

      return toSmsConfigSchema(result.rows[0]);
    } catch (error) {
      await client.query('ROLLBACK');
      logger.error('Failed to upsert SMS config', { error });
      if (error instanceof AppError) {
        throw error;
      }
      throw new AppError('Failed to update SMS configuration', 500, ERROR_CODES.INTERNAL_ERROR);
    } finally {
      client.release();
    }
  }

  // -------------------------------------------------------------------------
  // Private helpers for upsert
  // -------------------------------------------------------------------------

  /** Lock the singleton SMS config row, auto-creating if missing */
  private async lockOrCreateSingletonRow(
    client: PoolClient
  ): Promise<{ id: string; auth_token_encrypted: string }> {
    let result = await client.query(
      'SELECT id, auth_token_encrypted FROM sms.config LIMIT 1 FOR UPDATE'
    );

    if (!result.rows.length) {
      const insertResult = await client.query(
        `INSERT INTO sms.config DEFAULT VALUES
         ON CONFLICT DO NOTHING
         RETURNING id, auth_token_encrypted`
      );

      if (insertResult.rows.length) {
        result = insertResult;
      } else {
        // Race: another connection inserted — re-fetch with lock
        result = await client.query(
          'SELECT id, auth_token_encrypted FROM sms.config LIMIT 1 FOR UPDATE'
        );
      }
    }

    if (!result.rows.length) {
      throw new AppError('Failed to initialize SMS configuration', 500, ERROR_CODES.INTERNAL_ERROR);
    }

    return result.rows[0];
  }

  /** Verify Twilio credentials before persisting config */
  private async verifyTwilioCredentials(
    input: UpsertSmsConfigRequest,
    existingAuthTokenEncrypted: string
  ): Promise<void> {
    const authToken =
      input.authToken ?? this.getDecryptedAuthToken(existingAuthTokenEncrypted) ?? '';

    if (!authToken) {
      throw new AppError(
        'Auth token is required when enabling custom SMS',
        400,
        ERROR_CODES.INVALID_INPUT
      );
    }

    await new TwilioSmsProvider().verifyCredentials(input.accountSid, authToken);
  }
}
