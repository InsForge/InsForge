import crypto from 'crypto';
import { Pool } from 'pg';
import { DatabaseManager } from '@/infra/database/database.manager.js';
import { AppError } from '@/api/middlewares/error.js';
import { ERROR_CODES } from '@/types/error-constants.js';
import logger from '@/utils/logger.js';
import { generateSecureToken } from '@/utils/utils.js';
import type {
  CreateDeviceAuthorizationRequest,
  DeviceAuthorizationSessionSchema,
} from '@insforge/shared-schemas';

interface DeviceAuthorizationRow {
  id: string;
  device_code_hash: string;
  user_code_hash: string;
  status:
    | 'pending_authorization'
    | 'authenticated'
    | 'approved'
    | 'denied'
    | 'expired'
    | 'consumed';
  expires_at: string;
  poll_interval_seconds: number;
  approved_by_user_id: string | null;
  consumed_at: string | null;
  client_context: Record<string, unknown> | null;
  created_at: string;
  updated_at: string;
}

export type DeviceAuthorizationSessionView = Omit<
  DeviceAuthorizationSessionSchema,
  'deviceCode' | 'userCode'
>;

export type DeviceAuthorizationCreatedSession = DeviceAuthorizationSessionView & {
  deviceCode: string;
  userCode: string;
};

const DEFAULT_EXPIRES_IN_MS = 15 * 60 * 1000;
const DEFAULT_POLL_INTERVAL_SECONDS = 5;
const USER_CODE_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
const USER_CODE_SEGMENT_LENGTH = 5;
const USER_CODE_LENGTH = USER_CODE_SEGMENT_LENGTH * 2;
const CREATE_DEVICE_AUTHORIZATION_MAX_ATTEMPTS = 5;

export class DeviceAuthorizationService {
  private static instance: DeviceAuthorizationService;
  private pool: Pool | null = null;

  private constructor() {
    logger.info('DeviceAuthorizationService initialized');
  }

  public static getInstance(): DeviceAuthorizationService {
    if (!DeviceAuthorizationService.instance) {
      DeviceAuthorizationService.instance = new DeviceAuthorizationService();
    }
    return DeviceAuthorizationService.instance;
  }

  private getPool(): Pool {
    if (!this.pool) {
      this.pool = DatabaseManager.getInstance().getPool();
    }
    return this.pool;
  }

  private hashCode(value: string): string {
    return crypto.createHash('sha256').update(value).digest('hex');
  }

  private generateUserCode(): string {
    let raw = '';

    for (let index = 0; index < USER_CODE_LENGTH; index += 1) {
      raw += USER_CODE_ALPHABET[crypto.randomInt(0, USER_CODE_ALPHABET.length)];
    }

    return `${raw.slice(0, USER_CODE_SEGMENT_LENGTH)}-${raw.slice(USER_CODE_SEGMENT_LENGTH)}`;
  }

  private isUniqueViolation(error: unknown): boolean {
    return (
      !!error &&
      typeof error === 'object' &&
      'code' in error &&
      (error as { code?: string }).code === '23505'
    );
  }

  private normalizeClientContext(
    input: CreateDeviceAuthorizationRequest
  ): Record<string, unknown> | null {
    const clientContext = {
      ...(input.deviceName ? { deviceName: input.deviceName } : {}),
      ...(input.hostname ? { hostname: input.hostname } : {}),
      ...(input.platform ? { platform: input.platform } : {}),
    };

    return Object.keys(clientContext).length > 0 ? clientContext : null;
  }

  private toPublicSession(row: DeviceAuthorizationRow): DeviceAuthorizationSessionView {
    return {
      id: row.id,
      status: row.status,
      expiresAt: row.expires_at,
      pollIntervalSeconds: row.poll_interval_seconds,
      approvedByUserId: row.approved_by_user_id,
      consumedAt: row.consumed_at,
      clientContext: row.client_context,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };
  }

  private cloneRow(row: DeviceAuthorizationRow): DeviceAuthorizationRow {
    return {
      ...row,
      client_context: row.client_context ? { ...row.client_context } : null,
    };
  }

  private async expireRow(id: string): Promise<DeviceAuthorizationSessionView | null> {
    const result = await this.getPool().query(
      `UPDATE auth.device_authorizations
       SET status = 'expired', updated_at = NOW()
       WHERE id = $1 AND status NOT IN ('expired', 'consumed', 'denied')
       RETURNING
         id,
         device_code_hash,
         user_code_hash,
         status,
         expires_at,
         poll_interval_seconds,
         approved_by_user_id,
         consumed_at,
         client_context,
         created_at,
         updated_at`,
      [id]
    );

    const row = result.rows[0] as DeviceAuthorizationRow | undefined;
    return row ? this.toPublicSession(row) : null;
  }

  private async loadByUserCodeHash(userCodeHash: string): Promise<DeviceAuthorizationRow | null> {
    const result = await this.getPool().query(
      `SELECT
         id,
         device_code_hash,
         user_code_hash,
         status,
         expires_at,
         poll_interval_seconds,
         approved_by_user_id,
         consumed_at,
         client_context,
         created_at,
         updated_at
       FROM auth.device_authorizations
       WHERE user_code_hash = $1
       LIMIT 1`,
      [userCodeHash]
    );

    const row = result.rows[0] as DeviceAuthorizationRow | undefined;
    return row ? this.cloneRow(row) : null;
  }

  private async loadByDeviceCodeHash(
    deviceCodeHash: string
  ): Promise<DeviceAuthorizationRow | null> {
    const result = await this.getPool().query(
      `SELECT
         id,
         device_code_hash,
         user_code_hash,
         status,
         expires_at,
         poll_interval_seconds,
         approved_by_user_id,
         consumed_at,
         client_context,
         created_at,
         updated_at
       FROM auth.device_authorizations
       WHERE device_code_hash = $1
       LIMIT 1`,
      [deviceCodeHash]
    );

    const row = result.rows[0] as DeviceAuthorizationRow | undefined;
    return row ? this.cloneRow(row) : null;
  }

  private async loadByDeviceCodeHashForUpdate(
    client: Pick<Pool, 'query'>,
    deviceCodeHash: string
  ): Promise<DeviceAuthorizationRow | null> {
    const result = await client.query(
      `SELECT
         id,
         device_code_hash,
         user_code_hash,
         status,
         expires_at,
         poll_interval_seconds,
         approved_by_user_id,
         consumed_at,
         client_context,
         created_at,
         updated_at
       FROM auth.device_authorizations
       WHERE device_code_hash = $1
       LIMIT 1
       FOR UPDATE`,
      [deviceCodeHash]
    );

    const row = result.rows[0] as DeviceAuthorizationRow | undefined;
    return row ? this.cloneRow(row) : null;
  }

  private hasForeignBoundUser(row: DeviceAuthorizationRow, userId?: string): boolean {
    return !!userId && !!row.approved_by_user_id && row.approved_by_user_id !== userId;
  }

  private async throwForCurrentState(
    row: DeviceAuthorizationRow | null,
    userId?: string
  ): Promise<never> {
    if (!row) {
      throw new AppError('Device authorization not found', 404, ERROR_CODES.NOT_FOUND);
    }

    if (this.hasForeignBoundUser(row, userId)) {
      throw new AppError('Device authorization bound to another user', 403, ERROR_CODES.FORBIDDEN);
    }

    if (row.status === 'denied') {
      throw new AppError(
        'Device authorization denied',
        403,
        ERROR_CODES.AUTH_DEVICE_AUTHORIZATION_DENIED
      );
    }

    if (row.status === 'consumed') {
      throw new AppError(
        'Device authorization already consumed',
        409,
        ERROR_CODES.AUTH_DEVICE_AUTHORIZATION_CONSUMED
      );
    }

    if (new Date(row.expires_at).getTime() <= Date.now()) {
      await this.expireRow(row.id);
      throw new AppError(
        'Device authorization expired',
        410,
        ERROR_CODES.AUTH_DEVICE_AUTHORIZATION_EXPIRED
      );
    }

    throw new AppError(
      'Device authorization pending',
      428,
      ERROR_CODES.AUTH_DEVICE_AUTHORIZATION_PENDING
    );
  }

  async create(
    input: CreateDeviceAuthorizationRequest
  ): Promise<DeviceAuthorizationCreatedSession> {
    const expiresAt = new Date(Date.now() + DEFAULT_EXPIRES_IN_MS).toISOString();
    const clientContext = this.normalizeClientContext(input);

    for (let attempt = 1; attempt <= CREATE_DEVICE_AUTHORIZATION_MAX_ATTEMPTS; attempt += 1) {
      const deviceCode = generateSecureToken(32);
      const userCode = this.generateUserCode();

      try {
        const result = await this.getPool().query(
          `INSERT INTO auth.device_authorizations (
             device_code_hash,
             user_code_hash,
             status,
             expires_at,
             poll_interval_seconds,
             client_context
           )
           VALUES ($1, $2, 'pending_authorization', $3, $4, $5::jsonb)
           RETURNING
             id,
             device_code_hash,
             user_code_hash,
             status,
             expires_at,
             poll_interval_seconds,
             approved_by_user_id,
             consumed_at,
             client_context,
             created_at,
             updated_at`,
          [
            this.hashCode(deviceCode),
            this.hashCode(userCode),
            expiresAt,
            DEFAULT_POLL_INTERVAL_SECONDS,
            clientContext ? JSON.stringify(clientContext) : null,
          ]
        );

        const row = result.rows[0] as DeviceAuthorizationRow | undefined;
        if (!row) {
          throw new AppError(
            'Failed to create device authorization',
            500,
            ERROR_CODES.INTERNAL_ERROR
          );
        }

        return { ...this.toPublicSession(this.cloneRow(row)), deviceCode, userCode };
      } catch (error) {
        if (error instanceof AppError) {
          throw error;
        }

        if (this.isUniqueViolation(error) && attempt < CREATE_DEVICE_AUTHORIZATION_MAX_ATTEMPTS) {
          logger.warn('Device authorization code collision detected; retrying', { attempt });
          continue;
        }

        logger.error('Failed to create device authorization', { error, attempt });
        throw new AppError(
          'Failed to create device authorization',
          500,
          ERROR_CODES.INTERNAL_ERROR
        );
      }
    }

    throw new AppError('Failed to create device authorization', 500, ERROR_CODES.INTERNAL_ERROR);
  }

  async findByUserCode(userCode: string): Promise<DeviceAuthorizationSessionView | null> {
    const userCodeHash = this.hashCode(userCode);
    const row = await this.loadByUserCodeHash(userCodeHash);

    if (!row) {
      return null;
    }

    if (row.status === 'denied' || row.status === 'consumed') {
      return this.toPublicSession(row);
    }

    if (new Date(row.expires_at).getTime() <= Date.now() && row.status !== 'expired') {
      return this.expireRow(row.id);
    }

    return this.toPublicSession(row);
  }

  async markAuthenticated(
    userCode: string,
    userId: string
  ): Promise<DeviceAuthorizationSessionView> {
    const userCodeHash = this.hashCode(userCode);

    const result = await this.getPool().query(
      `UPDATE auth.device_authorizations
       SET status = 'authenticated',
           approved_by_user_id = COALESCE(approved_by_user_id, $2),
           updated_at = NOW()
       WHERE user_code_hash = $1
         AND status IN ('pending_authorization', 'authenticated')
         AND consumed_at IS NULL
         AND expires_at > NOW()
       RETURNING
         id,
         device_code_hash,
         user_code_hash,
         status,
         expires_at,
         poll_interval_seconds,
         approved_by_user_id,
         consumed_at,
         client_context,
         created_at,
         updated_at`,
      [userCodeHash, userId]
    );

    const row = result.rows[0] as DeviceAuthorizationRow | undefined;
    if (row) {
      return this.toPublicSession(row);
    }

    const current = await this.loadByUserCodeHash(userCodeHash);
    return await this.throwForCurrentState(current, userId);
  }

  async approve(userCode: string, userId: string): Promise<DeviceAuthorizationSessionView> {
    const userCodeHash = this.hashCode(userCode);

    const result = await this.getPool().query(
      `UPDATE auth.device_authorizations
       SET status = 'approved',
           approved_by_user_id = COALESCE(approved_by_user_id, $2),
           updated_at = NOW()
       WHERE user_code_hash = $1
         AND status IN ('pending_authorization', 'authenticated', 'approved')
         AND consumed_at IS NULL
         AND expires_at > NOW()
         AND (approved_by_user_id IS NULL OR approved_by_user_id = $2)
       RETURNING
         id,
         device_code_hash,
         user_code_hash,
         status,
         expires_at,
         poll_interval_seconds,
         approved_by_user_id,
         consumed_at,
         client_context,
         created_at,
         updated_at`,
      [userCodeHash, userId]
    );

    const row = result.rows[0] as DeviceAuthorizationRow | undefined;
    if (row) {
      return this.toPublicSession(row);
    }

    const current = await this.loadByUserCodeHash(userCodeHash);
    return await this.throwForCurrentState(current, userId);
  }

  async deny(userCode: string, userId: string): Promise<DeviceAuthorizationSessionView> {
    const userCodeHash = this.hashCode(userCode);

    const result = await this.getPool().query(
      `UPDATE auth.device_authorizations
       SET status = 'denied',
           updated_at = NOW()
       WHERE user_code_hash = $1
         AND status IN ('pending_authorization', 'authenticated', 'approved', 'denied')
         AND consumed_at IS NULL
         AND expires_at > NOW()
         AND (approved_by_user_id IS NULL OR approved_by_user_id = $2)
       RETURNING
         id,
         device_code_hash,
         user_code_hash,
         status,
         expires_at,
         poll_interval_seconds,
         approved_by_user_id,
         consumed_at,
         client_context,
         created_at,
         updated_at`,
      [userCodeHash, userId]
    );

    const row = result.rows[0] as DeviceAuthorizationRow | undefined;
    if (row) {
      return this.toPublicSession(row);
    }

    const current = await this.loadByUserCodeHash(userCodeHash);
    return await this.throwForCurrentState(current, userId);
  }

  async consumeApproved(deviceCode: string): Promise<DeviceAuthorizationSessionView> {
    const deviceCodeHash = this.hashCode(deviceCode);

    const result = await this.getPool().query(
      `UPDATE auth.device_authorizations
       SET status = 'consumed',
           consumed_at = NOW(),
           updated_at = NOW()
       WHERE device_code_hash = $1
         AND status = 'approved'
         AND consumed_at IS NULL
         AND expires_at > NOW()
       RETURNING
         id,
         device_code_hash,
         user_code_hash,
         status,
         expires_at,
         poll_interval_seconds,
         approved_by_user_id,
         consumed_at,
         client_context,
         created_at,
         updated_at`,
      [deviceCodeHash]
    );

    const row = result.rows[0] as DeviceAuthorizationRow | undefined;
    if (row) {
      return this.toPublicSession(row);
    }

    const current = await this.loadByDeviceCodeHash(deviceCodeHash);
    if (!current) {
      throw new AppError('Device authorization not found', 404, ERROR_CODES.NOT_FOUND);
    }

    if (current.status === 'denied') {
      throw new AppError(
        'Device authorization denied',
        403,
        ERROR_CODES.AUTH_DEVICE_AUTHORIZATION_DENIED
      );
    }

    if (current.status === 'consumed') {
      throw new AppError(
        'Device authorization already consumed',
        409,
        ERROR_CODES.AUTH_DEVICE_AUTHORIZATION_CONSUMED
      );
    }

    if (new Date(current.expires_at).getTime() <= Date.now()) {
      await this.expireRow(current.id);
      throw new AppError(
        'Device authorization expired',
        410,
        ERROR_CODES.AUTH_DEVICE_AUTHORIZATION_EXPIRED
      );
    }

    throw new AppError(
      'Device authorization pending',
      428,
      ERROR_CODES.AUTH_DEVICE_AUTHORIZATION_PENDING
    );
  }

  async exchangeApproved<T>(
    deviceCode: string,
    mintSession: (userId: string) => Promise<T>
  ): Promise<T> {
    const deviceCodeHash = this.hashCode(deviceCode);
    const pool = this.getPool();
    const client = await pool.connect();

    try {
      await client.query('BEGIN');

      const current = await this.loadByDeviceCodeHashForUpdate(client, deviceCodeHash);
      if (!current) {
        throw new AppError('Device authorization not found', 404, ERROR_CODES.NOT_FOUND);
      }

      if (current.status === 'denied') {
        throw new AppError(
          'Device authorization denied',
          403,
          ERROR_CODES.AUTH_DEVICE_AUTHORIZATION_DENIED
        );
      }

      if (current.status === 'consumed') {
        throw new AppError(
          'Device authorization already consumed',
          409,
          ERROR_CODES.AUTH_DEVICE_AUTHORIZATION_CONSUMED
        );
      }

      if (new Date(current.expires_at).getTime() <= Date.now()) {
        throw new AppError(
          'Device authorization expired',
          410,
          ERROR_CODES.AUTH_DEVICE_AUTHORIZATION_EXPIRED
        );
      }

      if (current.status !== 'approved' || !current.approved_by_user_id) {
        throw new AppError(
          'Device authorization pending',
          428,
          ERROR_CODES.AUTH_DEVICE_AUTHORIZATION_PENDING
        );
      }

      const session = await mintSession(current.approved_by_user_id);

      const consumedResult = await client.query(
        `UPDATE auth.device_authorizations
         SET status = 'consumed',
             consumed_at = NOW(),
             updated_at = NOW()
         WHERE device_code_hash = $1
           AND status = 'approved'
           AND consumed_at IS NULL
           AND expires_at > NOW()
         RETURNING id`,
        [deviceCodeHash]
      );

      if (!consumedResult.rows[0]) {
        const latest = await this.loadByDeviceCodeHashForUpdate(client, deviceCodeHash);
        if (latest && new Date(latest.expires_at).getTime() <= Date.now()) {
          throw new AppError(
            'Device authorization expired',
            410,
            ERROR_CODES.AUTH_DEVICE_AUTHORIZATION_EXPIRED
          );
        }
        await this.throwForCurrentState(latest);
      }

      await client.query('COMMIT');
      return session;
    } catch (error) {
      try {
        await client.query('ROLLBACK');
      } catch {
        // Ignore rollback errors and rethrow the original failure.
      }
      throw error;
    } finally {
      client.release();
    }
  }
}
