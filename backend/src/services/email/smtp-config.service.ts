import net from 'net';
import { Pool, PoolClient } from 'pg';
import dns from 'dns/promises';
import nodemailer from 'nodemailer';
import { DatabaseManager } from '@/infra/database/database.manager.js';
import { EncryptionManager } from '@/infra/security/encryption.manager.js';
import { AppError } from '@/api/middlewares/error.js';
import { ERROR_CODES } from '@/types/error-constants.js';
import logger from '@/utils/logger.js';
import type { SmtpConfigSchema, UpsertSmtpConfigRequest } from '@insforge/shared-schemas';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const ALLOWED_SMTP_PORTS = [25, 465, 587, 2525];

const SMTP_CONFIG_COLUMNS = `
  id, enabled, host, port, username, password_encrypted,
  sender_email as "senderEmail", sender_name as "senderName",
  min_interval_seconds as "minIntervalSeconds",
  created_at as "createdAt", updated_at as "updatedAt"`;

// ---------------------------------------------------------------------------
// SSRF prevention — private IP blocklist via Node.js net.BlockList
// Handles IPv4, IPv6, and IPv4-mapped IPv6 (::ffff:x.x.x.x) natively
// ---------------------------------------------------------------------------

const PRIVATE_IP_RANGES = new net.BlockList();
PRIVATE_IP_RANGES.addSubnet('127.0.0.0', 8, 'ipv4');
PRIVATE_IP_RANGES.addSubnet('10.0.0.0', 8, 'ipv4');
PRIVATE_IP_RANGES.addSubnet('172.16.0.0', 12, 'ipv4');
PRIVATE_IP_RANGES.addSubnet('192.168.0.0', 16, 'ipv4');
PRIVATE_IP_RANGES.addSubnet('169.254.0.0', 16, 'ipv4');
PRIVATE_IP_RANGES.addSubnet('100.64.0.0', 10, 'ipv4');
PRIVATE_IP_RANGES.addAddress('0.0.0.0', 'ipv4');
PRIVATE_IP_RANGES.addAddress('::1', 'ipv6');
PRIVATE_IP_RANGES.addAddress('::', 'ipv6');
PRIVATE_IP_RANGES.addSubnet('fe80::', 10, 'ipv6');
PRIVATE_IP_RANGES.addSubnet('fec0::', 10, 'ipv6');
PRIVATE_IP_RANGES.addSubnet('fc00::', 7, 'ipv6');

export function isPrivateIp(ip: string): boolean {
  if (net.isIPv4(ip)) {
    return PRIVATE_IP_RANGES.check(ip, 'ipv4');
  }
  if (net.isIPv6(ip)) {
    // Handle IPv4-mapped IPv6 (::ffff:x.x.x.x) — extract the IPv4 part
    const v4Mapped = ip.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/i);
    if (v4Mapped) {
      return PRIVATE_IP_RANGES.check(v4Mapped[1], 'ipv4');
    }
    return PRIVATE_IP_RANGES.check(ip, 'ipv6');
  }
  return false;
}

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

/** Map a DB row to the public SmtpConfigSchema (password masked) */
function toSmtpConfigSchema(row: Record<string, unknown>): SmtpConfigSchema {
  return {
    id: row.id as string,
    enabled: row.enabled as boolean,
    host: row.host as string,
    port: row.port as number,
    username: row.username as string,
    hasPassword: !!row.password_encrypted,
    senderEmail: row.senderEmail as string,
    senderName: row.senderName as string,
    minIntervalSeconds: row.minIntervalSeconds as number,
    createdAt: toISOString(row.createdAt),
    updatedAt: toISOString(row.updatedAt),
  };
}

const EMPTY_CONFIG: SmtpConfigSchema = {
  id: '00000000-0000-0000-0000-000000000000',
  enabled: false,
  host: '',
  port: 465,
  username: '',
  hasPassword: false,
  senderEmail: '',
  senderName: '',
  minIntervalSeconds: 60,
  createdAt: '',
  updatedAt: '',
};

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

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

// ---------------------------------------------------------------------------
// Service
// ---------------------------------------------------------------------------

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

  // -------------------------------------------------------------------------
  // Reads
  // -------------------------------------------------------------------------

  async getSmtpConfig(): Promise<SmtpConfigSchema> {
    try {
      const result = await this.getPool().query(
        `SELECT ${SMTP_CONFIG_COLUMNS} FROM email.config LIMIT 1`
      );
      if (!result.rows.length) {
        const now = new Date().toISOString();
        return { ...EMPTY_CONFIG, createdAt: now, updatedAt: now };
      }
      return toSmtpConfigSchema(result.rows[0]);
    } catch (error) {
      logger.error('Failed to get SMTP config', { error });
      throw new AppError('Failed to get SMTP configuration', 500, ERROR_CODES.INTERNAL_ERROR);
    }
  }

  async getRawSmtpConfig(): Promise<RawSmtpConfig | null> {
    try {
      const result = await this.getPool().query(
        `SELECT ${SMTP_CONFIG_COLUMNS} FROM email.config LIMIT 1`
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

  // -------------------------------------------------------------------------
  // Write
  // -------------------------------------------------------------------------

  async upsertSmtpConfig(input: UpsertSmtpConfigRequest): Promise<SmtpConfigSchema> {
    const client = await this.getPool().connect();
    try {
      await client.query('BEGIN');

      const existingRow = await this.lockOrCreateSingletonRow(client);

      let passwordEncrypted = existingRow.password_encrypted;
      if (input.password) {
        passwordEncrypted = EncryptionManager.encrypt(input.password);
      }

      if (input.host) {
        await this.validateSmtpHost(input.host, input.port);
      }

      if (input.enabled) {
        await this.verifySmtpConnection(input, existingRow.password_encrypted);
      }

      const result = await client.query(
        `UPDATE email.config SET
           enabled = $1, host = $2, port = $3, username = $4,
           password_encrypted = $5, sender_email = $6, sender_name = $7,
           min_interval_seconds = $8, updated_at = NOW()
         WHERE id = $9
         RETURNING ${SMTP_CONFIG_COLUMNS}`,
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

      return toSmtpConfigSchema(result.rows[0]);
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

  // -------------------------------------------------------------------------
  // Private helpers for upsert
  // -------------------------------------------------------------------------

  /** Lock the singleton SMTP config row, auto-creating if missing */
  private async lockOrCreateSingletonRow(
    client: PoolClient
  ): Promise<{ id: string; password_encrypted: string }> {
    let result = await client.query(
      'SELECT id, password_encrypted FROM email.config LIMIT 1 FOR UPDATE'
    );

    if (!result.rows.length) {
      const insertResult = await client.query(
        `INSERT INTO email.config DEFAULT VALUES
         ON CONFLICT DO NOTHING
         RETURNING id, password_encrypted`
      );

      if (insertResult.rows.length) {
        result = insertResult;
      } else {
        // Race: another connection inserted — re-fetch with lock
        result = await client.query(
          'SELECT id, password_encrypted FROM email.config LIMIT 1 FOR UPDATE'
        );
      }
    }

    if (!result.rows.length) {
      throw new AppError(
        'Failed to initialize SMTP configuration',
        500,
        ERROR_CODES.INTERNAL_ERROR
      );
    }

    return result.rows[0];
  }

  /** Validate SMTP host resolves to a public IP and uses an allowed port */
  private async validateSmtpHost(host: string, port: number): Promise<void> {
    if (!ALLOWED_SMTP_PORTS.includes(port)) {
      throw new AppError(
        `Invalid SMTP port: ${port}. Allowed ports: ${ALLOWED_SMTP_PORTS.join(', ')}`,
        400,
        ERROR_CODES.INVALID_INPUT
      );
    }

    // If the host is a raw IP address, validate it directly without DNS
    if (net.isIP(host)) {
      if (isPrivateIp(host)) {
        throw new AppError(
          'SMTP host is a private or loopback address, which is not allowed',
          400,
          ERROR_CODES.INVALID_INPUT
        );
      }
      return;
    }

    try {
      const [ipv4, ipv6] = await Promise.all([
        dns.resolve4(host).catch(() => []),
        dns.resolve6(host).catch(() => []),
      ]);
      const privateAddr = [...ipv4, ...ipv6].find(isPrivateIp);
      if (privateAddr) {
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

  /** Verify SMTP connectivity before persisting config */
  private async verifySmtpConnection(
    input: UpsertSmtpConfigRequest,
    existingPasswordEncrypted: string
  ): Promise<void> {
    const password = input.password ?? this.getDecryptedPassword(existingPasswordEncrypted) ?? '';

    if (!password) {
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
        auth: { user: input.username, pass: password },
        connectionTimeout: 10000,
      });
      await transporter.verify();
      transporter.close();
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown connection error';
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
}
