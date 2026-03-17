import { Pool } from 'pg';
import dns from 'dns/promises';
import nodemailer from 'nodemailer';
import { DatabaseManager } from '@/infra/database/database.manager.js';
import { EncryptionManager } from '@/infra/security/encryption.manager.js';
import { AppError } from '@/api/middlewares/error.js';
import { ERROR_CODES } from '@/types/error-constants.js';
import logger from '@/utils/logger.js';
import type { SmtpConfigSchema, UpsertSmtpConfigRequest } from '@insforge/shared-schemas';

const ALLOWED_SMTP_PORTS = [25, 465, 587, 2525];

/**
 * Check if an IP address is private, loopback, or link-local (RFC 1918 / RFC 4193)
 */
function isPrivateIp(ip: string): boolean {
  const lower = ip.toLowerCase();
  // IPv4: loopback, private, link-local, unspecified
  if (/^(127\.|10\.|192\.168\.|169\.254\.|0\.0\.0\.0)/.test(ip)) {
    return true;
  }
  if (/^172\.(1[6-9]|2\d|3[01])\./.test(ip)) {
    return true;
  }
  // IPv6: loopback, unspecified, link-local (fe80:), unique local (fc/fd)
  if (lower === '::1' || lower === '::') {
    return true;
  }
  if (/^(fe80:|f[cd])/.test(lower)) {
    return true;
  }
  return false;
}

/**
 * Raw SMTP config with decrypted password (for internal provider use)
 */
export interface RawSmtpConfig {
  id: string;
  enabled: boolean;
  host: string;
  port: number;
  username: string;
  password: string;
  senderEmail: string;
  senderName: string;
  minIntervalSeconds: number;
}

export class SmtpConfigService {
  private static instance: SmtpConfigService;
  private pool: Pool | null = null;

  private constructor() {
    logger.info('SmtpConfigService initialized');
  }

  public static getInstance(): SmtpConfigService {
    if (!SmtpConfigService.instance) {
      SmtpConfigService.instance = new SmtpConfigService();
    }
    return SmtpConfigService.instance;
  }

  private getPool(): Pool {
    if (!this.pool) {
      this.pool = DatabaseManager.getInstance().getPool();
    }
    return this.pool;
  }

  /**
   * Decrypt password from encrypted ciphertext
   */
  private getDecryptedPassword(passwordEncrypted: string): string | null {
    if (!passwordEncrypted) {
      return null;
    }
    try {
      return EncryptionManager.decrypt(passwordEncrypted);
    } catch (error) {
      logger.error('Failed to decrypt SMTP password — credentials may be corrupted', { error });
      return null;
    }
  }

  /**
   * Get SMTP configuration with password masked as hasPassword boolean
   * Safe for API responses
   */
  async getSmtpConfig(): Promise<SmtpConfigSchema> {
    try {
      const result = await this.getPool().query(
        `SELECT
          id,
          enabled,
          host,
          port,
          username,
          password_encrypted,
          sender_email as "senderEmail",
          sender_name as "senderName",
          min_interval_seconds as "minIntervalSeconds",
          created_at as "createdAt",
          updated_at as "updatedAt"
         FROM auth.smtp_configs
         LIMIT 1`
      );

      if (!result.rows.length) {
        return {
          id: '00000000-0000-0000-0000-000000000000',
          enabled: false,
          host: '',
          port: 465,
          username: '',
          hasPassword: false,
          senderEmail: '',
          senderName: '',
          minIntervalSeconds: 60,
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        };
      }

      const row = result.rows[0];
      return {
        id: row.id,
        enabled: row.enabled,
        host: row.host,
        port: row.port,
        username: row.username,
        hasPassword: !!row.password_encrypted,
        senderEmail: row.senderEmail,
        senderName: row.senderName,
        minIntervalSeconds: row.minIntervalSeconds,
        createdAt: row.createdAt,
        updatedAt: row.updatedAt,
      };
    } catch (error) {
      logger.error('Failed to get SMTP config', { error });
      throw new AppError('Failed to get SMTP configuration', 500, ERROR_CODES.INTERNAL_ERROR);
    }
  }

  /**
   * Get raw SMTP config with decrypted password (for internal use by providers)
   * Returns null if SMTP is not enabled
   */
  async getRawSmtpConfig(): Promise<RawSmtpConfig | null> {
    try {
      const result = await this.getPool().query(
        `SELECT
          id,
          enabled,
          host,
          port,
          username,
          password_encrypted,
          sender_email as "senderEmail",
          sender_name as "senderName",
          min_interval_seconds as "minIntervalSeconds"
         FROM auth.smtp_configs
         LIMIT 1`
      );

      if (!result.rows.length) {
        return null;
      }

      const row = result.rows[0];
      if (!row.enabled) {
        return null;
      }

      const password = this.getDecryptedPassword(row.password_encrypted);
      if (password === null) {
        logger.error('SMTP config has undecryptable credentials — treating as unconfigured');
        return null;
      }

      return {
        id: row.id,
        enabled: row.enabled,
        host: row.host,
        port: row.port,
        username: row.username,
        password,
        senderEmail: row.senderEmail,
        senderName: row.senderName,
        minIntervalSeconds: row.minIntervalSeconds,
      };
    } catch (error) {
      logger.error('Failed to get raw SMTP config', { error });
      return null;
    }
  }

  /**
   * Create or update SMTP configuration
   * Validates SMTP connection before persisting when enabled
   */
  async upsertSmtpConfig(input: UpsertSmtpConfigRequest): Promise<SmtpConfigSchema> {
    const client = await this.getPool().connect();
    try {
      await client.query('BEGIN');

      // Lock existing row for update
      const existingResult = await client.query(
        'SELECT id, password_encrypted FROM auth.smtp_configs LIMIT 1 FOR UPDATE'
      );

      if (!existingResult.rows.length) {
        await client.query('ROLLBACK');
        throw new AppError(
          'SMTP configuration not found. Please run migrations.',
          500,
          ERROR_CODES.INTERNAL_ERROR
        );
      }

      const existingRow = existingResult.rows[0];

      // Determine password: use new password if provided, otherwise keep existing
      let passwordEncrypted = existingRow.password_encrypted;
      if (input.password) {
        passwordEncrypted = EncryptionManager.encrypt(input.password);
      }

      // Validate SMTP host and port before connecting (SSRF prevention)
      if (input.enabled) {
        if (!ALLOWED_SMTP_PORTS.includes(input.port)) {
          await client.query('ROLLBACK');
          throw new AppError(
            `Invalid SMTP port: ${input.port}. Allowed ports: ${ALLOWED_SMTP_PORTS.join(', ')}`,
            400,
            ERROR_CODES.INVALID_INPUT
          );
        }

        try {
          const addresses = await dns.resolve4(input.host).catch(() => []);
          const addresses6 = await dns.resolve6(input.host).catch(() => []);
          const allAddresses = [...addresses, ...addresses6];
          const privateAddr = allAddresses.find(isPrivateIp);
          if (privateAddr) {
            await client.query('ROLLBACK');
            throw new AppError(
              'SMTP host resolves to a private or loopback address, which is not allowed',
              400,
              ERROR_CODES.INVALID_INPUT
            );
          }
        } catch (error) {
          if (error instanceof AppError) {
            throw error;
          }
          // DNS resolution failure is fine — transporter.verify() will catch it
        }
      }

      // Validate SMTP connection before persisting
      if (input.enabled) {
        const passwordToVerify = input.password
          ? input.password
          : (this.getDecryptedPassword(existingRow.password_encrypted) ?? '');

        if (!passwordToVerify) {
          await client.query('ROLLBACK');
          throw new AppError(
            'SMTP password is required when enabling SMTP',
            400,
            ERROR_CODES.INVALID_INPUT
          );
        }

        try {
          const transporter = nodemailer.createTransport({
            host: input.host,
            port: input.port,
            secure: input.port === 465,
            auth: {
              user: input.username,
              pass: passwordToVerify,
            },
            connectionTimeout: 10000,
          });

          await transporter.verify();
          transporter.close();
        } catch (verifyError) {
          await client.query('ROLLBACK');
          const message =
            verifyError instanceof Error ? verifyError.message : 'Unknown connection error';
          logger.error('SMTP connection verification failed', {
            host: input.host,
            port: input.port,
            error: message,
          });
          throw new AppError(
            `SMTP connection failed: ${message}`,
            400,
            ERROR_CODES.EMAIL_SMTP_CONNECTION_FAILED
          );
        }
      }

      const result = await client.query(
        `UPDATE auth.smtp_configs
         SET
           enabled = $1,
           host = $2,
           port = $3,
           username = $4,
           password_encrypted = $5,
           sender_email = $6,
           sender_name = $7,
           min_interval_seconds = $8,
           updated_at = NOW()
         WHERE id = $9
         RETURNING
           id,
           enabled,
           host,
           port,
           username,
           password_encrypted,
           sender_email as "senderEmail",
           sender_name as "senderName",
           min_interval_seconds as "minIntervalSeconds",
           created_at as "createdAt",
           updated_at as "updatedAt"`,
        [
          input.enabled,
          input.host,
          input.port,
          input.username,
          passwordEncrypted,
          input.senderEmail,
          input.senderName,
          input.minIntervalSeconds ?? 60,
          existingRow.id,
        ]
      );

      await client.query('COMMIT');
      logger.info('SMTP config updated', {
        enabled: input.enabled,
        host: input.host,
        port: input.port,
      });

      const row = result.rows[0];
      return {
        id: row.id,
        enabled: row.enabled,
        host: row.host,
        port: row.port,
        username: row.username,
        hasPassword: !!row.password_encrypted,
        senderEmail: row.senderEmail,
        senderName: row.senderName,
        minIntervalSeconds: row.minIntervalSeconds,
        createdAt: row.createdAt,
        updatedAt: row.updatedAt,
      };
    } catch (error) {
      await client.query('ROLLBACK');
      logger.error('Failed to upsert SMTP config', { error });
      if (error instanceof AppError) {
        throw error;
      }
      throw new AppError('Failed to update SMTP configuration', 500, ERROR_CODES.INTERNAL_ERROR);
    } finally {
      client.release();
    }
  }
}
