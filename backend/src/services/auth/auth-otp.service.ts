import { Pool, PoolClient } from 'pg';
import bcrypt from 'bcryptjs';
import crypto from 'crypto';
import { DatabaseManager } from '@/infra/database/database.manager.js';
import { AppError } from '@/utils/errors.js';
import { ERROR_CODES } from '@insforge/shared-schemas';
import logger from '@/utils/logger.js';
import { generateNumericCode, generateSecureToken } from '@/utils/utils.js';

/**
 * OTP purpose types - used to categorize different OTP use cases
 */
export enum OTPPurpose {
  VERIFY_EMAIL = 'VERIFY_EMAIL',
  RESET_PASSWORD = 'RESET_PASSWORD',
  SIGN_IN = 'SIGN_IN',
}

/**
 * Token type - determines token format and expiration
 */
export enum OTPType {
  NUMERIC_CODE = 'NUMERIC_CODE', // Short 6-digit numeric code for manual entry
  HASH_TOKEN = 'HASH_TOKEN', // Long cryptographic token with hash-based lookup
}

/**
 * Result of OTP creation
 */
export interface CreateOTPResult {
  success: boolean;
  otp: string;
  expiresAt: Date;
}

/**
 * Result of OTP verification
 */
export interface VerifyOTPResult {
  success: boolean;
  email: string;
  purpose: OTPPurpose;
  redirectTo?: string | null;
}

export type VerifyOTPAttemptResult =
  | {
      success: true;
      value: VerifyOTPResult;
    }
  | {
      success: false;
      error: AppError;
    };

/**
 * Service for managing email-based one-time passwords (OTPs)
 *
 * Supports two delivery methods:
 * 1. Short numeric codes (6 digits) - displayed in email for manual entry
 *    - Stored as bcrypt hash (defense against brute force if DB compromised)
 *    - Brute force protection uses persisted attempt counts plus API rate limiting
 * 2. Long cryptographic tokens (64 chars) - embedded in clickable links for one-click verification
 *    - Stored as SHA-256 hash (high entropy makes bcrypt unnecessary, allows direct lookup)
 *
 * The dual hashing strategy balances security and performance:
 * - NUMERIC_CODE: Low entropy (10^6 combinations) requires slow bcrypt + API rate limiting
 * - HASH_TOKEN: High entropy (2^256 combinations) only needs fast SHA-256
 */
export class AuthOTPService {
  private static instance: AuthOTPService;
  private pool: Pool | null = null;

  // Configuration constants
  private readonly NUMERIC_CODE_LENGTH = 6; // 6 digits = 1 million combinations
  private readonly NUMERIC_CODE_EXPIRY_MINUTES = 15; // 15 minutes expiry for numeric codes
  private readonly HASH_TOKEN_BYTES = 32; // 32 bytes = 64 hex characters = 256 bits entropy
  private readonly HASH_TOKEN_EXPIRY_HOURS = 24; // 24 hours expiry for hash tokens
  private readonly BCRYPT_SALT_ROUNDS = 10; // Salt rounds for numeric codes (2^10 iterations)
  private readonly MAX_NUMERIC_CODE_ATTEMPTS = 3;

  private constructor() {
    logger.info('AuthOTPService initialized');
  }

  public static getInstance(): AuthOTPService {
    if (!AuthOTPService.instance) {
      AuthOTPService.instance = new AuthOTPService();
    }
    return AuthOTPService.instance;
  }

  private getPool(): Pool {
    if (!this.pool) {
      this.pool = DatabaseManager.getInstance().getPool();
    }
    return this.pool;
  }

  /**
   * Create or update an email OTP
   * Supports both short numeric codes (for manual entry) and long cryptographic tokens (for clickable links)
   * Uses upsert to ensure only one active token exists per email/purpose combination
   *
   * Hashing strategy:
   * - NUMERIC_CODE: Uses bcrypt (slow hash) due to low entropy (10^6 combinations)
   * - HASH_TOKEN: Uses SHA-256 (fast hash) - high entropy (2^256) makes bcrypt unnecessary
   *
   * @param email - The email address for the token
   * @param purpose - The purpose of the token (e.g., 'VERIFY_EMAIL', 'RESET_PASSWORD')
   * @param otpType - The type of token to generate ('NUMERIC_CODE' or 'HASH_TOKEN')
   * @returns Promise with creation result including the token and expiry time
   */
  async createEmailOTP(
    email: string,
    purpose: OTPPurpose,
    otpType: OTPType = OTPType.NUMERIC_CODE,
    options?: {
      redirectTo?: string | null;
      expiresInMinutes?: number;
    }
  ): Promise<CreateOTPResult> {
    try {
      // Generate token based on type
      let otp: string;
      let expiresAt: Date;
      let otpHash: string;

      if (otpType === OTPType.NUMERIC_CODE) {
        // Generate 6-digit numeric code for manual entry
        otp = generateNumericCode(this.NUMERIC_CODE_LENGTH);
        const expiresInMinutes = options?.expiresInMinutes ?? this.NUMERIC_CODE_EXPIRY_MINUTES;
        expiresAt = new Date(Date.now() + expiresInMinutes * 60 * 1000);
        // Use bcrypt for low-entropy codes (defense against brute force)
        otpHash = await bcrypt.hash(otp, this.BCRYPT_SALT_ROUNDS);
      } else {
        // Generate cryptographically secure token for hash-based lookup
        otp = generateSecureToken(this.HASH_TOKEN_BYTES);
        expiresAt = new Date(Date.now() + this.HASH_TOKEN_EXPIRY_HOURS * 60 * 60 * 1000);
        // Use SHA-256 for high-entropy tokens (enables direct lookup)
        otpHash = crypto.createHash('sha256').update(otp).digest('hex');
      }

      // Upsert token record - insert or update if email+purpose combination already exists
      // This ensures only one active token per email/purpose (replaces any existing token)
      await this.getPool().query(
        `INSERT INTO auth.email_otps (
           email, purpose, otp_hash, otp_type, expires_at, consumed_at, redirect_to, attempts_count
         )
         VALUES ($1, $2, $3, $4, $5, NULL, $6, 0)
         ON CONFLICT (email, purpose)
         DO UPDATE SET
           otp_hash = EXCLUDED.otp_hash,
           otp_type = EXCLUDED.otp_type,
           expires_at = EXCLUDED.expires_at,
           redirect_to = EXCLUDED.redirect_to,
           consumed_at = NULL,
           attempts_count = 0,
           updated_at = NOW()`,
        [email, purpose, otpHash, otpType, expiresAt, options?.redirectTo ?? null]
      );

      logger.info('Email verification token created successfully', {
        purpose,
        otpType,
        expiresAt: expiresAt.toISOString(),
      });

      return {
        success: true,
        otp,
        expiresAt,
      };
    } catch (error) {
      logger.error('Failed to create email verification token', { error, purpose, otpType });
      throw new AppError('Failed to create verification token', 500, ERROR_CODES.INTERNAL_ERROR);
    }
  }

  private invalidCodeError(): AppError {
    return new AppError('Invalid or expired verification code', 400, ERROR_CODES.INVALID_INPUT);
  }

  /**
   * Low-level primitive: attempt a numeric OTP verification on a caller-owned
   * transaction. Expected failures are returned (not thrown) so the persisted
   * attempt counter can be committed before the error surfaces.
   *
   * Prefer {@link consumeNumericOTP}, which owns the transaction and guarantees
   * the counter is committed even on failure. Call this directly only from
   * inside a transaction you commit on both the success and failure paths;
   * throwing-and-rolling-back here would silently discard the attempt counter.
   *
   * Scoped to NUMERIC_CODE rows so a wrong code can never touch a HASH_TOKEN row
   * (magic-link) sharing the same (email, purpose).
   */
  async attemptEmailOTPWithCode(
    client: PoolClient,
    email: string,
    purpose: OTPPurpose,
    code: string
  ): Promise<VerifyOTPAttemptResult> {
    const result = await client.query(
      `SELECT
         id, email, purpose, otp_hash, expires_at, consumed_at, redirect_to, attempts_count
       FROM auth.email_otps
       WHERE email = $1 AND purpose = $2 AND otp_type = 'NUMERIC_CODE'
       FOR UPDATE`,
      [email, purpose]
    );

    if (result.rows.length === 0) {
      return { success: false, error: this.invalidCodeError() };
    }

    const otpRecord = result.rows[0];

    if (
      new Date() > new Date(otpRecord.expires_at) ||
      otpRecord.consumed_at !== null ||
      otpRecord.attempts_count >= this.MAX_NUMERIC_CODE_ATTEMPTS
    ) {
      return { success: false, error: this.invalidCodeError() };
    }

    const isValid = await bcrypt.compare(code, otpRecord.otp_hash);

    if (!isValid) {
      await client.query(
        `UPDATE auth.email_otps
         SET
           attempts_count = attempts_count + 1,
           consumed_at = CASE
             WHEN attempts_count + 1 >= $2 THEN NOW()
             ELSE consumed_at
           END,
           updated_at = NOW()
         WHERE id = $1`,
        [otpRecord.id, this.MAX_NUMERIC_CODE_ATTEMPTS]
      );
      return { success: false, error: this.invalidCodeError() };
    }

    const consume = await client.query(
      `UPDATE auth.email_otps
       SET consumed_at = NOW(), updated_at = NOW()
       WHERE id = $1 AND consumed_at IS NULL`,
      [otpRecord.id]
    );

    if (consume.rowCount !== 1) {
      return { success: false, error: this.invalidCodeError() };
    }

    logger.info('Numeric OTP code verified successfully', { purpose });

    return {
      success: true,
      value: {
        success: true,
        email: otpRecord.email,
        purpose: otpRecord.purpose,
        redirectTo: otpRecord.redirect_to,
      },
    };
  }

  /**
   * Verify a numeric OTP code and run caller work in one transaction.
   *
   * Owns the transaction boundary so callers cannot break the brute-force
   * invariant: a failed attempt is committed (persisting the attempt counter)
   * before its error is thrown, a successful attempt plus the caller's
   * `onVerified` work commit together, and any error thrown by `onVerified`
   * rolls the whole transaction back (un-consuming the code).
   *
   * `onVerified` receives the same open client and the verification result, so
   * it can read/write additional rows atomically with the OTP consumption.
   */
  async consumeNumericOTP<T>(
    email: string,
    purpose: OTPPurpose,
    code: string,
    onVerified: (client: PoolClient, verified: VerifyOTPResult) => Promise<T>
  ): Promise<T> {
    const client = await this.getPool().connect();
    let transactionActive = false;

    try {
      await client.query('BEGIN');
      transactionActive = true;

      const attempt = await this.attemptEmailOTPWithCode(client, email, purpose, code);
      if (!attempt.success) {
        // Commit the persisted attempt counter before surfacing the failure.
        await client.query('COMMIT');
        transactionActive = false;
        throw attempt.error;
      }

      const result = await onVerified(client, attempt.value);

      await client.query('COMMIT');
      transactionActive = false;
      return result;
    } catch (error) {
      if (transactionActive) {
        await client.query('ROLLBACK');
      }

      if (error instanceof AppError) {
        throw error;
      }

      logger.error('Failed to verify numeric OTP code', { error, purpose });
      throw new AppError('Failed to verify code', 500, ERROR_CODES.INTERNAL_ERROR);
    } finally {
      client.release();
    }
  }

  /**
   * Verify a hash token (64 hex characters)
   * Performs direct lookup using SHA-256 hash without knowing the email
   *
   * @param purpose - The purpose of the OTP
   * @param token - The 64-character hex token to verify
   * @param externalClient - Optional external database client for transaction support
   * @returns Promise with verification result including the associated email
   * @throws AppError if verification fails (with generic error message)
   */
  async verifyEmailOTPWithToken(
    purpose: OTPPurpose,
    token: string,
    externalClient?: PoolClient
  ): Promise<VerifyOTPResult> {
    const client = externalClient || (await this.getPool().connect());
    const shouldManageTransaction = !externalClient;

    try {
      if (shouldManageTransaction) {
        await client.query('BEGIN');
      }

      // Hash the token and perform direct lookup
      const tokenHash = crypto.createHash('sha256').update(token).digest('hex');

      // Direct lookup by hash - O(1) with index on otp_hash
      const result = await client.query(
        `SELECT id, email, purpose, otp_hash, expires_at, consumed_at, redirect_to
         FROM auth.email_otps
         WHERE purpose = $1
           AND otp_type = 'HASH_TOKEN'
           AND otp_hash = $2
           AND expires_at > NOW()
           AND consumed_at IS NULL
         FOR UPDATE`,
        [purpose, tokenHash]
      );

      // Check if token exists and is valid
      if (result.rows.length === 0) {
        throw new AppError('Invalid or expired verification token', 400, ERROR_CODES.INVALID_INPUT);
      }

      const otpRecord = result.rows[0];

      // Mark OTP as consumed atomically
      const consume = await client.query(
        `UPDATE auth.email_otps
         SET consumed_at = NOW(), updated_at = NOW()
         WHERE id = $1 AND consumed_at IS NULL`,
        [otpRecord.id]
      );

      if (consume.rowCount !== 1) {
        throw new AppError('Invalid or expired verification token', 400, ERROR_CODES.INVALID_INPUT);
      }

      if (shouldManageTransaction) {
        await client.query('COMMIT');
      }

      logger.info('Hash token verified successfully', { purpose });

      return {
        success: true,
        email: otpRecord.email,
        purpose: otpRecord.purpose,
        redirectTo: otpRecord.redirect_to,
      };
    } catch (error) {
      if (shouldManageTransaction) {
        await client.query('ROLLBACK');
      }

      if (error instanceof AppError) {
        throw error;
      }

      logger.error('Failed to verify hash token', { error, purpose });
      throw new AppError('Failed to verify token', 500, ERROR_CODES.INTERNAL_ERROR);
    } finally {
      if (shouldManageTransaction) {
        client.release();
      }
    }
  }

  /**
   * Exchange a verified numeric code for a long-lived hash token
   * This is a common pattern in multi-step verification flows:
   * 1. User receives numeric code via email
   * 2. User submits code to verify
   * 3. System issues a long-lived token for subsequent operations
   *
   * The entire exchange happens atomically within a single transaction to ensure:
   * - Numeric code is consumed only if token creation succeeds
   * - No race conditions between verification and token issuance
   *
   * Example use cases:
   * - Password reset: verify code → get reset token → reset password
   * - Email verification: verify code → get session token → auto-login
   *
   * @param email - The email address associated with the code
   * @param purpose - The purpose of the OTP (e.g., RESET_PASSWORD)
   * @param numericCode - The 6-digit numeric code to verify
   * @returns Promise with the long-lived token and its expiration
   * @throws AppError if verification fails or token creation fails
   */
  async exchangeCodeForToken(
    email: string,
    purpose: OTPPurpose,
    numericCode: string
  ): Promise<{ token: string; expiresAt: Date }> {
    // Verify + consume the numeric code and issue the token in one transaction:
    // the code is consumed only if token issuance succeeds.
    return this.consumeNumericOTP(email, purpose, numericCode, async (client) => {
      // Generate a long-lived hash token
      const token = generateSecureToken(this.HASH_TOKEN_BYTES);
      const expiresAt = new Date(Date.now() + this.HASH_TOKEN_EXPIRY_HOURS * 60 * 60 * 1000);
      const tokenHash = crypto.createHash('sha256').update(token).digest('hex');

      // Insert the new token, replacing the consumed numeric code for this
      // (email, purpose) and flipping the row's type to HASH_TOKEN.
      await client.query(
        `INSERT INTO auth.email_otps (
           email, purpose, otp_hash, otp_type, expires_at, consumed_at, redirect_to, attempts_count
         )
         VALUES ($1, $2, $3, 'HASH_TOKEN', $4, NULL, NULL, 0)
         ON CONFLICT (email, purpose)
         DO UPDATE SET
           otp_hash = EXCLUDED.otp_hash,
           otp_type = EXCLUDED.otp_type,
           expires_at = EXCLUDED.expires_at,
           redirect_to = EXCLUDED.redirect_to,
           consumed_at = NULL,
           attempts_count = 0,
           updated_at = NOW()`,
        [email, purpose, tokenHash, expiresAt]
      );

      logger.info('Successfully exchanged numeric code for hash token', { email, purpose });

      return { token, expiresAt };
    });
  }

  /**
   * Resolve a link token to its associated metadata without consuming it.
   * This lets backend-owned action routes determine the validated redirect
   * destination before the browser is sent back to the app.
   */
  async getEmailOTPContextByToken(purpose: OTPPurpose, token: string): Promise<VerifyOTPResult> {
    try {
      const tokenHash = crypto.createHash('sha256').update(token).digest('hex');
      const result = await this.getPool().query(
        `SELECT email, purpose, redirect_to
         FROM auth.email_otps
         WHERE purpose = $1
           AND otp_hash = $2
         LIMIT 1`,
        [purpose, tokenHash]
      );

      if (result.rows.length === 0) {
        throw new AppError('Invalid or expired verification token', 400, ERROR_CODES.INVALID_INPUT);
      }

      return {
        success: true,
        email: result.rows[0].email,
        purpose: result.rows[0].purpose,
        redirectTo: result.rows[0].redirect_to,
      };
    } catch (error) {
      if (error instanceof AppError) {
        throw error;
      }

      logger.error('Failed to resolve hash token context', { error, purpose });
      throw new AppError('Failed to resolve verification token', 500, ERROR_CODES.INTERNAL_ERROR);
    }
  }
}
