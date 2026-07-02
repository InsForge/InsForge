import { describe, test, expect, beforeAll, afterAll } from 'vitest';
import bcrypt from 'bcryptjs';
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';

// Load environment variables from .env
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
dotenv.config({ path: path.resolve(__dirname, '../../../../.env') });

// Set default test environments
process.env.POSTGRES_HOST = process.env.POSTGRES_HOST || 'localhost';
process.env.POSTGRES_PORT = process.env.POSTGRES_PORT || '5432';
process.env.POSTGRES_USER = process.env.POSTGRES_USER || 'postgres';
process.env.POSTGRES_PASSWORD = process.env.POSTGRES_PASSWORD || 'postgres';
process.env.POSTGRES_DB = process.env.POSTGRES_DB || 'insforge';
process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-jwt-secret-key-for-local-testing';

import { DatabaseManager } from '../../../src/infra/database/database.manager.js';
import { AuthOTPService, OTPPurpose } from '../../../src/services/auth/auth-otp.service.js';
import { AppError } from '../../../src/utils/errors.js';

describe('AuthOTPService - Brute Force Vulnerability Integration Test', () => {
  let dbManager: DatabaseManager;
  let otpService: AuthOTPService;
  const testEmail = 'bruteforce-test@example.com';
  const correctCode = '123456';

  beforeAll(async () => {
    dbManager = DatabaseManager.getInstance();
    await dbManager.initialize();
    otpService = AuthOTPService.getInstance();

    const pool = dbManager.getPool();
    await pool.query('DELETE FROM auth.email_otps WHERE email = $1', [testEmail]);
  });

  afterAll(async () => {
    const pool = dbManager.getPool();
    await pool.query('DELETE FROM auth.email_otps WHERE email = $1', [testEmail]);
    await dbManager.close();
  });

  test('Vulnerability Proof: 10 failed attempts do not lock or consume the OTP', async () => {
    const pool = dbManager.getPool();

    const saltRounds = 10;
    const bcryptHash = await bcrypt.hash(correctCode, saltRounds);
    const expiresAt = new Date(Date.now() + 15 * 60 * 1000); // 15 minutes in future

    await pool.query(
      `INSERT INTO auth.email_otps (email, purpose, otp_hash, expires_at, consumed_at)
       VALUES ($1, $2, $3, $4, NULL)
       ON CONFLICT (email, purpose)
       DO UPDATE SET
         otp_hash = EXCLUDED.otp_hash,
         expires_at = EXCLUDED.expires_at,
         consumed_at = NULL,
         updated_at = NOW()`,
      [testEmail, OTPPurpose.VERIFY_EMAIL, bcryptHash, expiresAt]
    );

    console.log('\n---> Simulating 10 brute force attempts with incorrect codes...');
    for (let i = 1; i <= 10; i++) {
      const wrongCode = `99990${i}`;
      await expect(
        otpService.verifyEmailOTPWithCode(testEmail, OTPPurpose.VERIFY_EMAIL, wrongCode)
      ).rejects.toThrowError('Invalid or expired verification code');
    }
    console.log('---> Finished 10 failed verification requests. Checking database state...');

    const dbResult = await pool.query(
      'SELECT * FROM auth.email_otps WHERE email = $1 AND purpose = $2',
      [testEmail, OTPPurpose.VERIFY_EMAIL]
    );

    expect(dbResult.rows.length).toBe(1);
    const otpRecord = dbResult.rows[0];

    // PROOF 1: The OTP is NOT marked as consumed despite 10 failures
    expect(otpRecord.consumed_at).toBeNull();
    console.log(
      `[PROOF 1] consumed_at is: ${otpRecord.consumed_at} (Token remains active and valid!)`
    );

    // PROOF 2: The hash is unchanged
    expect(otpRecord.otp_hash).toBe(bcryptHash);
    console.log(`[PROOF 2] otp_hash matches original: ${otpRecord.otp_hash === bcryptHash}`);

    //     // PROOF 3: The database does not track failed attempts
    //     const columnCheck = await pool.query(`
    //       SELECT column_name
    //       FROM information_schema.columns
    //       WHERE table_schema = 'auth'
    //         AND table_name = 'email_otps'
    //         AND column_name IN ('attempts_count', 'failed_attempts')
    //     `);

    //     expect(columnCheck.rows.length).toBe(0);
    //     console.log(`[PROOF 3] Attempts/failure tracking columns in schema: ${JSON.stringify(columnCheck.rows)} (No columns found!)`);

    //     // 5. Verify the correct code still works
    //     const successResult = await otpService.verifyEmailOTPWithCode(
    //       testEmail,
    //       OTPPurpose.VERIFY_EMAIL,
    //       correctCode
    //     );

    //     expect(successResult.success).toBe(true);
    //     expect(successResult.email).toBe(testEmail);

    //     const finalDbResult = await pool.query(
    //       'SELECT consumed_at FROM auth.email_otps WHERE email = $1 AND purpose = $2',
    //       [testEmail, OTPPurpose.VERIFY_EMAIL]
    //     );
    //     expect(finalDbResult.rows[0].consumed_at).not.toBeNull();
  });
});
