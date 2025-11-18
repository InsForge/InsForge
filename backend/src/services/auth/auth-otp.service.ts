import { Pool, PoolClient } from 'pg';
import bcrypt from 'bcryptjs';
import crypto from 'crypto';
import { DatabaseManager } from '@/infra/database/manager.js';
import { AppError } from '@/api/middlewares/error.js';
import { ERROR_CODES } from '@/types/error-constants.js';
import logger from '@/utils/logger.js';
import { generateNumericCode, generateSecureToken } from '@/utils/utils.js';

/**
 * OTP purpose types - used to categorize different OTP use cases
 */
export enum OTPPurpose {
  VERIFY_EMAIL = 'VERIFY_EMAIL',
  RESET_PASSWORD = 'RESET_PASSWORD',
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
}

/**
 * Service for managing email-based one-time passwords (OTPs)
 *
 * Supports two delivery methods:
 * 1. Short numeric codes (6 digits) - displayed in email for manual entry
 *    - Stored as bcrypt hash (defense against brute force if DB compromised)
 *    - Brute force protection handled by API-level rate limiting
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
    otpType: OTPType = OTPType.NUMERIC_CODE
  ): Promise<CreateOTPResult> {
    const client = await this.getPool().connect();
    try {
      // Generate token based on type
      let otp: string;
      let expiresAt: Date;
      let otpHash: string;

      if (otpType === OTPType.NUMERIC_CODE) {
        // Generate 6-digit numeric code for manual entry
        otp = generateNumericCode(this.NUMERIC_CODE_LENGTH);
        expiresAt = new Date(Date.now() + this.NUMERIC_CODE_EXPIRY_MINUTES * 60 * 1000);
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
      await client.query(
        `INSERT INTO _email_otps (email, purpose, otp_hash, expires_at, consumed_at)
         VALUES ($1, $2, $3, $4, NULL)
         ON CONFLICT (email, purpose)
         DO UPDATE SET
           otp_hash = EXCLUDED.otp_hash,
           expires_at = EXCLUDED.expires_at,
           consumed_at = NULL,
           updated_at = NOW()`,
        [email, purpose, otpHash, expiresAt]
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
    } finally {
      client.release();
    }
  }

  /**
   * Verify a numeric OTP code (6 digits)
   * Looks up by email and verifies the bcrypt-hashed code
   *
   * Brute force protection is handled by API-level rate limiting.
   *
   * @param email - The email address associated with the OTP
   * @param purpose - The purpose of the OTP
   * @param code - The 6-digit numeric code to verify
   * @param externalClient - Optional external database client for transaction support
   * @returns Promise with verification result
   * @throws AppError if verification fails (with generic error message)
   */
  async verifyEmailOTPWithCode(
    email: string,
    purpose: OTPPurpose,
    code: string,
    externalClient?: PoolClient
  ): Promise<VerifyOTPResult> {
    const client = externalClient || (await this.getPool().connect());
    const shouldManageTransaction = !externalClient;

    try {
      if (shouldManageTransaction) {
        await client.query('BEGIN');
      }

      // Lookup by email and lock the row
      const result = await client.query(
        `SELECT id, email, purpose, otp_hash, expires_at, consumed_at
         FROM _email_otps
         WHERE email = $1 AND purpose = $2
         FOR UPDATE`,
        [email, purpose]
      );

      // Check if OTP record exists
      if (result.rows.length === 0) {
        throw new AppError('Invalid or expired verification code', 400, ERROR_CODES.INVALID_INPUT);
      }

      const otpRecord = result.rows[0];

      // Validate OTP record is still usable
      if (new Date() > new Date(otpRecord.expires_at) || otpRecord.consumed_at !== null) {
        throw new AppError('Invalid or expired verification code', 400, ERROR_CODES.INVALID_INPUT);
      }

      // Verify bcrypt hash
      const isValid = await bcrypt.compare(code, otpRecord.otp_hash);

      if (!isValid) {
        throw new AppError('Invalid or expired verification code', 400, ERROR_CODES.INVALID_INPUT);
      }

      // Mark OTP as consumed atomically
      const consume = await client.query(
        `UPDATE _email_otps
         SET consumed_at = NOW(), updated_at = NOW()
         WHERE id = $1 AND consumed_at IS NULL`,
        [otpRecord.id]
      );

      if (consume.rowCount !== 1) {
        throw new AppError('Invalid or expired verification code', 400, ERROR_CODES.INVALID_INPUT);
      }

      if (shouldManageTransaction) {
        await client.query('COMMIT');
      }

      logger.info('Numeric OTP code verified successfully', { purpose });

      return {
        success: true,
        email: otpRecord.email,
        purpose: otpRecord.purpose,
      };
    } catch (error) {
      if (shouldManageTransaction) {
        await client.query('ROLLBACK');
      }

      if (error instanceof AppError) {
        throw error;
      }

      logger.error('Failed to verify numeric OTP code', { error, purpose });
      throw new AppError('Failed to verify code', 500, ERROR_CODES.INTERNAL_ERROR);
    } finally {
      if (shouldManageTransaction) {
        client.release();
      }
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
        `SELECT id, email, purpose, otp_hash, expires_at, consumed_at
         FROM _email_otps
         WHERE purpose = $1
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
        `UPDATE _email_otps
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
   * @param externalClient - Optional external database client for broader transaction support
   * @returns Promise with the long-lived token and its expiration
   * @throws AppError if verification fails or token creation fails
   */
  async exchangeCodeForToken(
    email: string,
    purpose: OTPPurpose,
    numericCode: string,
    externalClient?: PoolClient
  ): Promise<{ token: string; expiresAt: Date }> {
    const client = externalClient || (await this.getPool().connect());
    const shouldManageTransaction = !externalClient;
    let transactionActive = false;

    try {
      if (shouldManageTransaction) {
        await client.query('BEGIN');
        transactionActive = true;
      }

      // Step 1: Verify the numeric code (consumes it atomically)
      await this.verifyEmailOTPWithCode(email, purpose, numericCode, client);

      // Step 2: Generate a long-lived hash token
      const token = generateSecureToken(this.HASH_TOKEN_BYTES);
      const expiresAt = new Date(Date.now() + this.HASH_TOKEN_EXPIRY_HOURS * 60 * 60 * 1000);
      const tokenHash = crypto.createHash('sha256').update(token).digest('hex');

      // Step 3: Insert the new token (replaces the consumed numeric code)
      // Uses upsert to overwrite the consumed code record with the new token
      await client.query(
        `INSERT INTO _email_otps (email, purpose, otp_hash, expires_at, consumed_at)
         VALUES ($1, $2, $3, $4, NULL)
         ON CONFLICT (email, purpose)
         DO UPDATE SET
           otp_hash = EXCLUDED.otp_hash,
           expires_at = EXCLUDED.expires_at,
           consumed_at = NULL,
           updated_at = NOW()`,
        [email, purpose, tokenHash, expiresAt]
      );

      if (shouldManageTransaction) {
        await client.query('COMMIT');
        transactionActive = false;
      }

      logger.info('Successfully exchanged numeric code for hash token', { email, purpose });

      return { token, expiresAt };
    } catch (error) {
      if (shouldManageTransaction && transactionActive) {
        await client.query('ROLLBACK');
      }

      if (error instanceof AppError) {
        throw error;
      }

      logger.error('Failed to exchange code for token', { error, email, purpose });
      throw new AppError('Failed to exchange verification code', 500, ERROR_CODES.INTERNAL_ERROR);
    } finally {
      if (shouldManageTransaction) {
        client.release();
      }
    }
  }
}
