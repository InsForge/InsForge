import jwt from 'jsonwebtoken';
import bcrypt from 'bcryptjs';
import crypto from 'crypto';
import dotenv from 'dotenv';
import { verifyCloudToken } from '@/utils/cloud-token.js';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import { DatabaseManager } from '@/infra/database/manager.js';
import logger from '@/utils/logger.js';
import type {
  UserSchema,
  CreateUserResponse,
  CreateSessionResponse,
  VerifyEmailResponse,
  ResetPasswordResponse,
  CreateAdminSessionResponse,
  TokenPayloadSchema,
  AuthMetadataSchema,
  OAuthProvidersSchema,
} from '@insforge/shared-schemas';
import { OAuthConfigService } from '@/services/auth/oauth-config.service';
import { AuthConfigService } from './auth-config.service';
import { AuthOTPService, OTPPurpose, OTPType } from './auth-otp.service';
import { GoogleOAuthProvider } from '@/providers/oauth/google.provider';
import { GitHubOAuthProvider } from '@/providers/oauth/github.provider';
import { DiscordOAuthProvider } from '@/providers/oauth/discord.provider';
import { LinkedInOAuthProvider } from '@/providers/oauth/linkedin.provider';
import { FacebookOAuthProvider } from '@/providers/oauth/facebook.provider';
import { MicrosoftOAuthProvider } from '@/providers/oauth/microsoft.provider';
import { validatePassword } from '@/utils/validations';
import { getPasswordRequirementsMessage } from '@/utils/utils';
import {
  FacebookUserInfo,
  GitHubUserInfo,
  GoogleUserInfo,
  MicrosoftUserInfo,
  LinkedInUserInfo,
  DiscordUserInfo,
  XUserInfo,
  UserRecord,
  OAuthUserData,
} from '@/types/auth';
import { ADMIN_ID } from '@/utils/constants';
import { getApiBaseUrl } from '@/utils/environment';
import { AppError } from '@/api/middlewares/error';
import { ERROR_CODES } from '@/types/error-constants';
import { EmailService } from '@/services/email/email.service';
import { XOAuthProvider } from '@/providers/oauth/x.provider';

const JWT_SECRET = () => process.env.JWT_SECRET ?? '';
const JWT_EXPIRES_IN = '7d';

/**
 * Simplified JWT-based auth service
 * Handles all authentication operations including OAuth
 */
export class AuthService {
  private static instance: AuthService;
  private adminEmail: string;
  private adminPassword: string;
  private db;

  // OAuth service instances (cached singletons)
  private googleOAuthService: GoogleOAuthProvider;
  private githubOAuthService: GitHubOAuthProvider;
  private discordOAuthService: DiscordOAuthProvider;
  private linkedinOAuthService: LinkedInOAuthProvider;
  private facebookOAuthService: FacebookOAuthProvider;
  private microsoftOAuthService: MicrosoftOAuthProvider;
  private xOAuthService: XOAuthProvider;

  private constructor() {
    // Load .env file if not already loaded
    if (!process.env.JWT_SECRET) {
      const __filename = fileURLToPath(import.meta.url);
      const __dirname = path.dirname(__filename);
      const envPath = path.resolve(__dirname, '../../../../.env');
      if (fs.existsSync(envPath)) {
        dotenv.config({ path: envPath });
      } else {
        logger.warn('No .env file found, using default environment variables.');
        dotenv.config();
      }
    }

    if (!process.env.JWT_SECRET) {
      throw new Error('JWT_SECRET environment variable is required');
    }

    this.adminEmail = process.env.ADMIN_EMAIL ?? '';
    this.adminPassword = process.env.ADMIN_PASSWORD ?? '';

    if (!this.adminEmail || !this.adminPassword) {
      throw new Error('ADMIN_EMAIL and ADMIN_PASSWORD environment variables are required');
    }

    const dbManager = DatabaseManager.getInstance();
    this.db = dbManager.getDb();

    // Initialize OAuth services (cached singletons)
    this.googleOAuthService = GoogleOAuthProvider.getInstance();
    this.githubOAuthService = GitHubOAuthProvider.getInstance();
    this.discordOAuthService = DiscordOAuthProvider.getInstance();
    this.linkedinOAuthService = LinkedInOAuthProvider.getInstance();
    this.facebookOAuthService = FacebookOAuthProvider.getInstance();
    this.microsoftOAuthService = MicrosoftOAuthProvider.getInstance();
    this.xOAuthService = XOAuthProvider.getInstance();

    logger.info('AuthService initialized');
  }

  public static getInstance(): AuthService {
    if (!AuthService.instance) {
      AuthService.instance = new AuthService();
    }
    return AuthService.instance;
  }

  /**
   * Transform database user to API format (snake_case to camelCase)
   */
  private dbUserToApiUser(dbUser: UserRecord): UserSchema {
    return {
      id: dbUser.id,
      email: dbUser.email,
      name: dbUser.name,
      emailVerified: dbUser.email_verified,
      createdAt: dbUser.created_at,
      updatedAt: dbUser.updated_at,
    };
  }

  /**
   * Generate JWT token for users and admins
   */
  generateToken(payload: TokenPayloadSchema): string {
    return jwt.sign(payload, JWT_SECRET(), {
      algorithm: 'HS256',
      expiresIn: JWT_EXPIRES_IN,
    });
  }

  /**
   * Generate anonymous JWT token (never expires)
   */
  generateAnonToken(): string {
    const payload = {
      sub: '12345678-1234-5678-90ab-cdef12345678',
      email: 'anon@insforge.com',
      role: 'anon',
    };
    return jwt.sign(payload, JWT_SECRET(), {
      algorithm: 'HS256',
      // No expiresIn means token never expires
    });
  }

  /**
   * Verify JWT token
   */
  verifyToken(token: string): TokenPayloadSchema {
    try {
      const decoded = jwt.verify(token, JWT_SECRET()) as TokenPayloadSchema;
      return {
        sub: decoded.sub,
        email: decoded.email,
        role: decoded.role || 'authenticated',
      };
    } catch {
      throw new AppError('Invalid token', 401, ERROR_CODES.AUTH_UNAUTHORIZED);
    }
  }

  /**
   * User registration
   * Otherwise, returns user with access token for immediate login
   */
  async register(email: string, password: string, name?: string): Promise<CreateUserResponse> {
    // Get email auth configuration and validate password
    const authConfigService = AuthConfigService.getInstance();
    const emailAuthConfig = await authConfigService.getAuthConfig();

    if (!validatePassword(password, emailAuthConfig)) {
      throw new AppError(
        getPasswordRequirementsMessage(emailAuthConfig),
        400,
        ERROR_CODES.INVALID_INPUT
      );
    }

    const hashedPassword = await bcrypt.hash(password, 10);
    const userId = crypto.randomUUID();
    await this.db.exec('BEGIN');
    try {
      await this.db
        .prepare(
          `INSERT INTO _accounts (id, email, password, name, email_verified, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, NOW(), NOW())`
        )
        .run(userId, email, hashedPassword, name || null, false);

      await this.db
        .prepare(
          `INSERT INTO users (id, nickname, created_at, updated_at)
           VALUES (?, ?, NOW(), NOW())`
        )
        .run(userId, name || null);
      await this.db.exec('COMMIT');
    } catch (e) {
      await this.db.exec('ROLLBACK');
      // Postgres unique_violation
      if (e && typeof e === 'object' && 'code' in e && e.code === '23505') {
        throw new AppError('User already exists', 409, ERROR_CODES.ALREADY_EXISTS);
      }
      throw e;
    }

    const dbUser = await this.db
      .prepare(
        'SELECT id, email, name, email_verified, created_at, updated_at FROM _accounts WHERE id = ?'
      )
      .get(userId);
    const user = this.dbUserToApiUser(dbUser);

    if (emailAuthConfig.requireEmailVerification) {
      try {
        if (emailAuthConfig.verifyEmailMethod === 'link') {
          await this.sendVerificationEmailWithLink(email);
        } else {
          await this.sendVerificationEmailWithCode(email);
        }
      } catch (error) {
        logger.warn('Verification email send failed during register', { error });
      }
      return {
        accessToken: null,
        requireEmailVerification: true,
      };
    }

    // Email verification not required, provide access token for immediate login
    const accessToken = this.generateToken({ sub: userId, email, role: 'authenticated' });

    return {
      user,
      accessToken,
      requireEmailVerification: false,
      redirectTo: emailAuthConfig.signInRedirectTo || undefined,
    };
  }

  /**
   * User login
   */
  async login(email: string, password: string): Promise<CreateSessionResponse> {
    const dbUser = await this.db.prepare('SELECT * FROM _accounts WHERE email = ?').get(email);

    if (!dbUser || !dbUser.password) {
      throw new AppError('Invalid credentials', 401, ERROR_CODES.AUTH_UNAUTHORIZED);
    }

    const validPassword = await bcrypt.compare(password, dbUser.password);
    if (!validPassword) {
      throw new AppError('Invalid credentials', 401, ERROR_CODES.AUTH_UNAUTHORIZED);
    }

    // Check if email verification is required
    const authConfigService = AuthConfigService.getInstance();
    const emailAuthConfig = await authConfigService.getAuthConfig();

    if (emailAuthConfig.requireEmailVerification && !dbUser.email_verified) {
      throw new AppError(
        'Email verification required',
        403,
        ERROR_CODES.FORBIDDEN,
        'Please verify your email address before logging in'
      );
    }

    const user = this.dbUserToApiUser(dbUser);
    const accessToken = this.generateToken({
      sub: dbUser.id,
      email: dbUser.email,
      role: 'authenticated',
    });

    // Include redirect URL if configured
    const response: CreateSessionResponse = {
      user,
      accessToken,
      redirectTo: emailAuthConfig.signInRedirectTo || undefined,
    };

    return response;
  }

  /**
   * Send verification email with numeric OTP code
   * Creates a 6-digit OTP and sends it via email for manual entry
   */
  async sendVerificationEmailWithCode(email: string): Promise<void> {
    // Check if user exists
    const dbUser = await this.db.prepare('SELECT * FROM _accounts WHERE email = ?').get(email);
    if (!dbUser) {
      // Silently succeed to prevent user enumeration
      logger.info('Verification email requested for non-existent user', { email });
      return;
    }

    // Create numeric OTP code using the OTP service
    const otpService = AuthOTPService.getInstance();
    const { otp: code } = await otpService.createEmailOTP(
      email,
      OTPPurpose.VERIFY_EMAIL,
      OTPType.NUMERIC_CODE
    );

    // Send email with verification code
    const emailService = EmailService.getInstance();
    await emailService.sendWithTemplate(email, dbUser.name || 'User', 'email-verification-code', {
      token: code,
    });
  }

  /**
   * Send verification email with clickable link
   * Creates a long cryptographic token and sends it via email as a clickable link
   * The link contains only the token (no email) for better privacy and security
   */
  async sendVerificationEmailWithLink(email: string): Promise<void> {
    // Check if user exists
    const dbUser = await this.db.prepare('SELECT * FROM _accounts WHERE email = ?').get(email);
    if (!dbUser) {
      // Silently succeed to prevent user enumeration
      logger.info('Verification email requested for non-existent user', { email });
      return;
    }

    // Create long cryptographic token for clickable verification link
    const otpService = AuthOTPService.getInstance();
    const { otp: token } = await otpService.createEmailOTP(
      email,
      OTPPurpose.VERIFY_EMAIL,
      OTPType.HASH_TOKEN
    );

    // Build verification link URL using backend API endpoint
    const linkUrl = `${getApiBaseUrl()}/auth/verify-email?token=${token}`;

    // Send email with verification link
    const emailService = EmailService.getInstance();
    await emailService.sendWithTemplate(email, dbUser.name || 'User', 'email-verification-link', {
      link: linkUrl,
    });
  }

  /**
   * Verify email with numeric code
   * Verifies the email OTP code and updates the account in a single transaction
   */
  async verifyEmailWithCode(email: string, verificationCode: string): Promise<VerifyEmailResponse> {
    const dbManager = DatabaseManager.getInstance();
    const pool = dbManager.getPool();
    const client = await pool.connect();

    try {
      await client.query('BEGIN');

      // Verify OTP using the OTP service (within the same transaction)
      const otpService = AuthOTPService.getInstance();
      await otpService.verifyEmailOTPWithCode(
        email,
        OTPPurpose.VERIFY_EMAIL,
        verificationCode,
        client
      );

      // Update account email verification status
      const result = await client.query(
        `UPDATE _accounts
         SET email_verified = true, updated_at = NOW()
         WHERE email = $1
         RETURNING id, email, name, email_verified, created_at, updated_at`,
        [email]
      );

      if (result.rows.length === 0) {
        throw new Error('User not found');
      }

      await client.query('COMMIT');

      const dbUser = result.rows[0];
      const user = this.dbUserToApiUser(dbUser);
      const accessToken = this.generateToken({
        sub: dbUser.id,
        email: dbUser.email,
        role: 'authenticated',
      });

      // Get redirect URL from auth config if configured
      const authConfigService = AuthConfigService.getInstance();
      const emailAuthConfig = await authConfigService.getAuthConfig();

      return {
        user,
        accessToken,
        redirectTo: emailAuthConfig.signInRedirectTo || undefined,
      };
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  /**
   * Verify email with hash token from clickable link
   * Verifies the token (without needing email), looks up the email, and updates the account
   * This is more secure as the email is not exposed in the URL
   */
  async verifyEmailWithToken(token: string): Promise<VerifyEmailResponse> {
    const dbManager = DatabaseManager.getInstance();
    const pool = dbManager.getPool();
    const client = await pool.connect();

    try {
      await client.query('BEGIN');

      // Verify token and get the associated email
      const otpService = AuthOTPService.getInstance();
      const { email } = await otpService.verifyEmailOTPWithToken(
        OTPPurpose.VERIFY_EMAIL,
        token,
        client
      );

      // Update account email verification status
      const result = await client.query(
        `UPDATE _accounts
         SET email_verified = true, updated_at = NOW()
         WHERE email = $1
         RETURNING id, email, name, email_verified, created_at, updated_at`,
        [email]
      );

      if (result.rows.length === 0) {
        throw new Error('User not found');
      }

      await client.query('COMMIT');

      const dbUser = result.rows[0];
      const user = this.dbUserToApiUser(dbUser);
      const accessToken = this.generateToken({
        sub: dbUser.id,
        email: dbUser.email,
        role: 'authenticated',
      });

      // Get redirect URL from auth config if configured
      const authConfigService = AuthConfigService.getInstance();
      const emailAuthConfig = await authConfigService.getAuthConfig();

      return {
        user,
        accessToken,
        redirectTo: emailAuthConfig.signInRedirectTo || undefined,
      };
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  /**
   * Send reset password email with numeric OTP code
   * Creates a 6-digit OTP and sends it via email for manual entry
   */
  async sendResetPasswordEmailWithCode(email: string): Promise<void> {
    // Check if user exists
    const dbUser = await this.db.prepare('SELECT * FROM _accounts WHERE email = ?').get(email);
    if (!dbUser) {
      // Silently succeed to prevent user enumeration
      logger.info('Password reset requested for non-existent user', { email });
      return;
    }

    // Create numeric OTP code using the OTP service
    const otpService = AuthOTPService.getInstance();
    const { otp: code } = await otpService.createEmailOTP(
      email,
      OTPPurpose.RESET_PASSWORD,
      OTPType.NUMERIC_CODE
    );

    // Send email with reset password code
    const emailService = EmailService.getInstance();
    await emailService.sendWithTemplate(email, dbUser.name || 'User', 'reset-password-code', {
      token: code,
    });
  }

  /**
   * Send reset password email with clickable link
   * Creates a long cryptographic token and sends it via email as a clickable link
   * The link contains only the token (no email) for better privacy and security
   */
  async sendResetPasswordEmailWithLink(email: string): Promise<void> {
    // Check if user exists
    const dbUser = await this.db.prepare('SELECT * FROM _accounts WHERE email = ?').get(email);
    if (!dbUser) {
      // Silently succeed to prevent user enumeration
      logger.info('Password reset requested for non-existent user', { email });
      return;
    }

    // Create long cryptographic token for clickable reset link
    const otpService = AuthOTPService.getInstance();
    const { otp: token } = await otpService.createEmailOTP(
      email,
      OTPPurpose.RESET_PASSWORD,
      OTPType.HASH_TOKEN
    );

    // Build password reset link URL using backend API endpoint
    const linkUrl = `${getApiBaseUrl()}/auth/reset-password?token=${token}`;

    // Send email with password reset link
    const emailService = EmailService.getInstance();
    await emailService.sendWithTemplate(email, dbUser.name || 'User', 'reset-password-link', {
      link: linkUrl,
    });
  }

  /**
   * Exchange reset password code for a temporary reset token
   * This separates code verification from password reset for better security
   * The reset token can be used later to reset the password without needing email
   */
  async exchangeResetPasswordToken(
    email: string,
    verificationCode: string
  ): Promise<{ token: string; expiresAt: Date }> {
    const otpService = AuthOTPService.getInstance();

    // Exchange the numeric verification code for a long-lived reset token
    // All OTP logic (verification, consumption, token generation) is handled by AuthOTPService
    const result = await otpService.exchangeCodeForToken(
      email,
      OTPPurpose.RESET_PASSWORD,
      verificationCode
    );

    return {
      token: result.token,
      expiresAt: result.expiresAt,
    };
  }

  /**
   * Reset password with token
   * Verifies the token (without needing email), looks up the email, and updates the password
   * Both clickable link tokens and code-verified reset tokens use RESET_PASSWORD purpose
   * Note: Does not return access token - user must login again with new password
   */
  async resetPasswordWithToken(newPassword: string, token: string): Promise<ResetPasswordResponse> {
    // Validate password first before verifying token
    // This allows the user to retry with the same token if password is invalid
    const authConfigService = AuthConfigService.getInstance();
    const emailAuthConfig = await authConfigService.getAuthConfig();

    if (!validatePassword(newPassword, emailAuthConfig)) {
      throw new AppError(
        getPasswordRequirementsMessage(emailAuthConfig),
        400,
        ERROR_CODES.INVALID_INPUT
      );
    }

    const dbManager = DatabaseManager.getInstance();
    const pool = dbManager.getPool();
    const client = await pool.connect();

    try {
      await client.query('BEGIN');

      // Verify token and get the associated email
      // Both clickable link tokens and code-verified reset tokens use RESET_PASSWORD purpose
      const otpService = AuthOTPService.getInstance();
      const { email } = await otpService.verifyEmailOTPWithToken(
        OTPPurpose.RESET_PASSWORD,
        token,
        client
      );

      // Hash the new password
      const hashedPassword = await bcrypt.hash(newPassword, 10);

      // Update password in the database
      const result = await client.query(
        `UPDATE _accounts
         SET password = $1, updated_at = NOW()
         WHERE email = $2
         RETURNING id`,
        [hashedPassword, email]
      );

      if (result.rows.length === 0) {
        throw new Error('User not found');
      }

      const userId = result.rows[0].id;

      await client.query('COMMIT');

      logger.info('Password reset successfully with token', { userId });

      return {
        message: 'Password reset successfully. Please login with your new password.',
      };
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  /**
   * Admin login (validates against env variables only)
   */
  adminLogin(email: string, password: string): CreateAdminSessionResponse {
    // Simply validate against environment variables
    if (email !== this.adminEmail || password !== this.adminPassword) {
      throw new AppError('Invalid admin credentials', 401, ERROR_CODES.AUTH_UNAUTHORIZED);
    }

    // Use a fixed admin ID for the system administrator

    // Return admin user with JWT token - no database interaction
    const accessToken = this.generateToken({ sub: ADMIN_ID, email, role: 'project_admin' });

    return {
      user: {
        id: ADMIN_ID,
        email: email,
        name: 'Administrator',
        emailVerified: true,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      },
      accessToken,
    };
  }

  /**
   * Admin login with authorization token (validates JWT from external issuer)
   */
  async adminLoginWithAuthorizationCode(code: string): Promise<CreateAdminSessionResponse> {
    try {
      // Use the helper function to verify cloud token
      const { payload } = await verifyCloudToken(code);

      // If verification succeeds, extract user info and generate internal token
      const email = payload['email'] || payload['sub'] || 'admin@insforge.local';

      // Generate internal access token
      const accessToken = this.generateToken({
        sub: ADMIN_ID,
        email: email as string,
        role: 'project_admin',
      });

      return {
        user: {
          id: ADMIN_ID,
          email: email as string,
          name: 'Administrator',
          emailVerified: true,
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        },
        accessToken,
      };
    } catch (error) {
      logger.error('Admin token verification failed:', error);
      throw new AppError('Invalid admin credentials', 401, ERROR_CODES.AUTH_UNAUTHORIZED);
    }
  }

  /**
   * Find or create third-party user (main OAuth user handler)
   * Adapted from 3-table to 2-table structure
   */
  async findOrCreateThirdPartyUser(
    provider: string,
    providerId: string,
    email: string,
    userName: string,
    avatarUrl: string,
    identityData:
      | GoogleUserInfo
      | GitHubUserInfo
      | DiscordUserInfo
      | LinkedInUserInfo
      | MicrosoftUserInfo
      | FacebookUserInfo
      | XUserInfo
      | Record<string, unknown>
  ): Promise<CreateSessionResponse> {
    // First, try to find existing user by provider ID in _account_providers table
    const account = await this.db
      .prepare('SELECT * FROM _account_providers WHERE provider = ? AND provider_account_id = ?')
      .get(provider, providerId);

    if (account) {
      // Found existing OAuth user, update last login time
      await this.db
        .prepare(
          'UPDATE _account_providers SET updated_at = CURRENT_TIMESTAMP WHERE provider = ? AND provider_account_id = ?'
        )
        .run(provider, providerId);

      // Update email_verified to true if not already verified (OAuth login means email is trusted)
      await this.db
        .prepare(
          'UPDATE _accounts SET email_verified = true WHERE id = ? AND email_verified = false'
        )
        .run(account.user_id);

      const dbUser = await this.db
        .prepare(
          'SELECT id, email, name, email_verified, created_at, updated_at FROM _accounts WHERE id = ?'
        )
        .get(account.user_id);

      const user = this.dbUserToApiUser(dbUser);
      const accessToken = this.generateToken({
        sub: user.id,
        email: user.email,
        role: 'authenticated',
      });

      return { user, accessToken };
    }

    // If not found by provider_id, try to find by email in _user table
    const existingUser = await this.db
      .prepare('SELECT * FROM _accounts WHERE email = ?')
      .get(email);

    if (existingUser) {
      // Found existing user by email, create _account_providers record to link OAuth
      await this.db
        .prepare(
          `
        INSERT INTO _account_providers (
          user_id, provider, provider_account_id, 
          provider_data, created_at, updated_at
        )
        VALUES (?, ?, ?, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
      `
        )
        .run(existingUser.id, provider, providerId, JSON.stringify(identityData));

      // Update email_verified to true (OAuth login means email is trusted)
      await this.db
        .prepare(
          'UPDATE _accounts SET email_verified = true WHERE id = ? AND email_verified = false'
        )
        .run(existingUser.id);

      // Fetch updated user data
      const updatedUser = await this.db
        .prepare('SELECT * FROM _accounts WHERE id = ?')
        .get(existingUser.id);

      const user = this.dbUserToApiUser(updatedUser);
      const accessToken = this.generateToken({
        sub: existingUser.id,
        email: existingUser.email,
        role: 'authenticated',
      });

      return { user, accessToken };
    }

    // Create new user with OAuth data
    return this.createThirdPartyUser(
      provider,
      userName,
      email,
      providerId,
      identityData,
      avatarUrl
    );
  }

  /**
   * Create new third-party user
   */
  private async createThirdPartyUser(
    provider: string,
    userName: string,
    email: string,
    providerId: string,
    identityData:
      | GoogleUserInfo
      | GitHubUserInfo
      | DiscordUserInfo
      | LinkedInUserInfo
      | MicrosoftUserInfo
      | FacebookUserInfo
      | XUserInfo
      | Record<string, unknown>,
    avatarUrl: string
  ): Promise<CreateSessionResponse> {
    const userId = crypto.randomUUID();

    await this.db.exec('BEGIN');

    try {
      // Create user record (without password for OAuth users)
      await this.db
        .prepare(
          `
        INSERT INTO _accounts (id, email, name, email_verified, created_at, updated_at)
        VALUES (?, ?, ?, true, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
      `
        )
        .run(userId, email, userName);

      await this.db
        .prepare(
          `
        INSERT INTO users (id, nickname, avatar_url, created_at, updated_at)
        VALUES (?, ?, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
      `
        )
        .run(userId, userName, avatarUrl);

      // Create _account_providers record
      await this.db
        .prepare(
          `
        INSERT INTO _account_providers (
          user_id, provider, provider_account_id,
          provider_data, created_at, updated_at
        )
        VALUES (?, ?, ?, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
      `
        )
        .run(
          userId,
          provider,
          providerId,
          JSON.stringify({ ...identityData, avatar_url: avatarUrl })
        );

      await this.db.exec('COMMIT');

      const user: UserSchema = {
        id: userId,
        email,
        name: userName,
        emailVerified: true,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };

      const accessToken = this.generateToken({
        sub: userId,
        email,
        role: 'authenticated',
      });

      return { user, accessToken };
    } catch (error) {
      await this.db.exec('ROLLBACK');
      throw error;
    }
  }

  async getMetadata(): Promise<AuthMetadataSchema> {
    const oAuthConfigService = OAuthConfigService.getInstance();
    const oAuthConfigs = await oAuthConfigService.getAllConfigs();
    return {
      oauths: oAuthConfigs,
    };
  }

  /**
   * Generate OAuth authorization URL for any supported provider
   */
  async generateOAuthUrl(provider: OAuthProvidersSchema, state?: string): Promise<string> {
    switch (provider) {
      case 'google':
        return this.googleOAuthService.generateOAuthUrl(state);
      case 'github':
        return this.githubOAuthService.generateOAuthUrl(state);
      case 'discord':
        return this.discordOAuthService.generateOAuthUrl(state);
      case 'linkedin':
        return this.linkedinOAuthService.generateOAuthUrl(state);
      case 'facebook':
        return this.facebookOAuthService.generateOAuthUrl(state);
      case 'microsoft':
        return this.microsoftOAuthService.generateOAuthUrl(state);
      case 'x':
        return this.xOAuthService.generateOAuthUrl(state);
      default:
        throw new Error(`OAuth provider ${provider} is not implemented yet.`);
    }
  }

  /**
   * Handle OAuth callback for any supported provider
   */
  async handleOAuthCallback(
    provider: OAuthProvidersSchema,
    payload: { code?: string; token?: string; state?: string }
  ): Promise<CreateSessionResponse> {
    let userData: OAuthUserData;

    switch (provider) {
      case 'google':
        userData = await this.googleOAuthService.handleCallback(payload);
        break;
      case 'github':
        userData = await this.githubOAuthService.handleCallback(payload);
        break;
      case 'discord':
        userData = await this.discordOAuthService.handleCallback(payload);
        break;
      case 'linkedin':
        userData = await this.linkedinOAuthService.handleCallback(payload);
        break;
      case 'facebook':
        userData = await this.facebookOAuthService.handleCallback(payload);
        break;
      case 'microsoft':
        userData = await this.microsoftOAuthService.handleCallback(payload);
        break;
      case 'x':
        userData = await this.xOAuthService.handleCallback(payload);
        break;
      default:
        throw new Error(`OAuth provider ${provider} is not implemented yet.`);
    }

    return this.findOrCreateThirdPartyUser(
      userData.provider,
      userData.providerId,
      userData.email,
      userData.userName,
      userData.avatarUrl,
      userData.identityData
    );
  }

  /**
   * Handle shared callback for any supported provider
   * Transforms payload and creates/finds user
   */
  async handleSharedCallback(
    provider: OAuthProvidersSchema,
    payloadData: Record<string, unknown>
  ): Promise<CreateSessionResponse> {
    let userData: OAuthUserData;

    switch (provider) {
      case 'google':
        userData = this.googleOAuthService.handleSharedCallback(payloadData);
        break;
      case 'github':
        userData = this.githubOAuthService.handleSharedCallback(payloadData);
        break;
      case 'discord':
        userData = this.discordOAuthService.handleSharedCallback(payloadData);
        break;
      case 'linkedin':
        userData = this.linkedinOAuthService.handleSharedCallback(payloadData);
        break;
      case 'facebook':
        userData = this.facebookOAuthService.handleSharedCallback(payloadData);
        break;
      case 'x':
        userData = this.xOAuthService.handleSharedCallback(payloadData);
        break;
      case 'microsoft':
      default:
        throw new Error(`OAuth provider ${provider} is not supported for shared callback.`);
    }

    return this.findOrCreateThirdPartyUser(
      userData.provider,
      userData.providerId,
      userData.email,
      userData.userName,
      userData.avatarUrl,
      userData.identityData
    );
  }

  /**
   * Get database instance for direct queries
   */
  getDb() {
    return this.db;
  }
}
