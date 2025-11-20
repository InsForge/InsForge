import bcrypt from 'bcryptjs';
import crypto from 'crypto';
import { Pool } from 'pg';
import { DatabaseManager } from '@/infra/database/database.manager.js';
import { TokenManager } from '@/infra/security/token.manager.js';
import logger from '@/utils/logger.js';
import type {
  UserSchema,
  CreateUserResponse,
  CreateSessionResponse,
  VerifyEmailResponse,
  ResetPasswordResponse,
  CreateAdminSessionResponse,
  AuthMetadataSchema,
  OAuthProvidersSchema,
} from '@insforge/shared-schemas';
import { OAuthConfigService } from '@/services/auth/oauth-config.service.js';
import { AuthConfigService } from './auth-config.service.js';
import { AuthOTPService, OTPPurpose, OTPType } from './auth-otp.service.js';
import { GoogleOAuthProvider } from '@/providers/oauth/google.provider.js';
import { GitHubOAuthProvider } from '@/providers/oauth/github.provider.js';
import { DiscordOAuthProvider } from '@/providers/oauth/discord.provider.js';
import { LinkedInOAuthProvider } from '@/providers/oauth/linkedin.provider.js';
import { FacebookOAuthProvider } from '@/providers/oauth/facebook.provider.js';
import { MicrosoftOAuthProvider } from '@/providers/oauth/microsoft.provider.js';
import { validatePassword } from '@/utils/validations.js';
import { getPasswordRequirementsMessage } from '@/utils/utils.js';
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
} from '@/types/auth.js';
import { ADMIN_ID } from '@/utils/constants.js';
import { getApiBaseUrl } from '@/utils/environment.js';
import { AppError } from '@/api/middlewares/error.js';
import { ERROR_CODES } from '@/types/error-constants.js';
import { EmailService } from '@/services/email/email.service.js';
import { XOAuthProvider } from '@/providers/oauth/x.provider.js';

/**
 * Simplified JWT-based auth service
 * Handles all authentication operations including OAuth
 */
export class AuthService {
  private static instance: AuthService;
  private adminEmail: string;
  private adminPassword: string;
  private pool: Pool | null = null;
  private tokenManager: TokenManager;

  // OAuth provider instances (cached singletons)
  private googleOAuthProvider: GoogleOAuthProvider;
  private githubOAuthProvider: GitHubOAuthProvider;
  private discordOAuthProvider: DiscordOAuthProvider;
  private linkedinOAuthProvider: LinkedInOAuthProvider;
  private facebookOAuthProvider: FacebookOAuthProvider;
  private microsoftOAuthProvider: MicrosoftOAuthProvider;
  private xOAuthProvider: XOAuthProvider;

  private constructor() {
    this.adminEmail = process.env.ADMIN_EMAIL ?? '';
    this.adminPassword = process.env.ADMIN_PASSWORD ?? '';

    if (!this.adminEmail || !this.adminPassword) {
      throw new Error('ADMIN_EMAIL and ADMIN_PASSWORD environment variables are required');
    }

    // Initialize token manager
    this.tokenManager = TokenManager.getInstance();

    // Initialize OAuth providers (cached singletons)
    this.googleOAuthProvider = GoogleOAuthProvider.getInstance();
    this.githubOAuthProvider = GitHubOAuthProvider.getInstance();
    this.discordOAuthProvider = DiscordOAuthProvider.getInstance();
    this.linkedinOAuthProvider = LinkedInOAuthProvider.getInstance();
    this.facebookOAuthProvider = FacebookOAuthProvider.getInstance();
    this.microsoftOAuthProvider = MicrosoftOAuthProvider.getInstance();
    this.xOAuthProvider = XOAuthProvider.getInstance();

    logger.info('AuthService initialized');
  }

  public static getInstance(): AuthService {
    if (!AuthService.instance) {
      AuthService.instance = new AuthService();
    }
    return AuthService.instance;
  }

  private getPool(): Pool {
    if (!this.pool) {
      const dbManager = DatabaseManager.getInstance();
      this.pool = dbManager.getPool();
    }
    return this.pool;
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

    const pool = this.getPool();
    const client = await pool.connect();
    try {
      await client.query('BEGIN');

      await client.query(
        `INSERT INTO _accounts (id, email, password, name, email_verified, created_at, updated_at)
         VALUES ($1, $2, $3, $4, $5, NOW(), NOW())`,
        [userId, email, hashedPassword, name || null, false]
      );

      await client.query(
        `INSERT INTO users (id, nickname, created_at, updated_at)
         VALUES ($1, $2, NOW(), NOW())`,
        [userId, name || null]
      );

      await client.query('COMMIT');
    } catch (e) {
      await client.query('ROLLBACK');
      // Postgres unique_violation
      if (e && typeof e === 'object' && 'code' in e && e.code === '23505') {
        throw new AppError('User already exists', 409, ERROR_CODES.ALREADY_EXISTS);
      }
      throw e;
    } finally {
      client.release();
    }

    const dbUser = await this.getUserById(userId);
    if (!dbUser) {
      throw new Error('User not found after registration');
    }
    const user = this.transformUserRecordToSchema(dbUser);

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
    const accessToken = this.tokenManager.generateToken({
      sub: userId,
      email,
      role: 'authenticated',
    });

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
    const dbUser = await this.getUserByEmail(email);

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

    const user = this.transformUserRecordToSchema(dbUser);
    const accessToken = this.tokenManager.generateToken({
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
    const pool = this.getPool();
    const result = await pool.query('SELECT * FROM _accounts WHERE email = $1', [email]);
    const dbUser = result.rows[0];
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
    const pool = this.getPool();
    const result = await pool.query('SELECT * FROM _accounts WHERE email = $1', [email]);
    const dbUser = result.rows[0];
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
         RETURNING id`,
        [email]
      );

      if (result.rows.length === 0) {
        throw new Error('User not found');
      }

      await client.query('COMMIT');

      // Fetch full user record with provider data
      const userId = result.rows[0].id;
      const dbUser = await this.getUserById(userId);
      if (!dbUser) {
        throw new Error('User not found after verification');
      }
      const user = this.transformUserRecordToSchema(dbUser);
      const accessToken = this.tokenManager.generateToken({
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
         RETURNING id`,
        [email]
      );

      if (result.rows.length === 0) {
        throw new Error('User not found');
      }

      await client.query('COMMIT');

      // Fetch full user record with provider data
      const userId = result.rows[0].id;
      const dbUser = await this.getUserById(userId);
      if (!dbUser) {
        throw new Error('User not found after verification');
      }
      const user = this.transformUserRecordToSchema(dbUser);
      const accessToken = this.tokenManager.generateToken({
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
    const pool = this.getPool();
    const result = await pool.query('SELECT * FROM _accounts WHERE email = $1', [email]);
    const dbUser = result.rows[0];
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
    const pool = this.getPool();
    const result = await pool.query('SELECT * FROM _accounts WHERE email = $1', [email]);
    const dbUser = result.rows[0];
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
    const accessToken = this.tokenManager.generateToken({
      sub: ADMIN_ID,
      email,
      role: 'project_admin',
    });

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
      // Use TokenManager to verify cloud token
      const { payload } = await this.tokenManager.verifyCloudToken(code);

      // If verification succeeds, extract user info and generate internal token
      const email = payload['email'] || payload['sub'] || 'admin@insforge.local';

      // Generate internal access token
      const accessToken = this.tokenManager.generateToken({
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
    const pool = this.getPool();

    // First, try to find existing user by provider ID in _account_providers table
    const accountResult = await pool.query(
      'SELECT * FROM _account_providers WHERE provider = $1 AND provider_account_id = $2',
      [provider, providerId]
    );
    const account = accountResult.rows[0];

    if (account) {
      // Found existing OAuth user, update last login time
      await pool.query(
        'UPDATE _account_providers SET updated_at = CURRENT_TIMESTAMP WHERE provider = $1 AND provider_account_id = $2',
        [provider, providerId]
      );

      // Update email_verified to true if not already verified (OAuth login means email is trusted)
      await pool.query(
        'UPDATE _accounts SET email_verified = true WHERE id = $1 AND email_verified = false',
        [account.user_id]
      );

      const dbUser = await this.getUserById(account.user_id);
      if (!dbUser) {
        throw new Error('User not found after OAuth login');
      }

      const user = this.transformUserRecordToSchema(dbUser);
      const accessToken = this.tokenManager.generateToken({
        sub: user.id,
        email: user.email,
        role: 'authenticated',
      });

      return { user, accessToken };
    }

    // If not found by provider_id, try to find by email in _user table
    const existingUserResult = await pool.query('SELECT * FROM _accounts WHERE email = $1', [
      email,
    ]);
    const existingUser = existingUserResult.rows[0];

    if (existingUser) {
      // Found existing user by email, create _account_providers record to link OAuth
      await pool.query(
        `
        INSERT INTO _account_providers (
          user_id, provider, provider_account_id,
          provider_data, created_at, updated_at
        )
        VALUES ($1, $2, $3, $4, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
      `,
        [existingUser.id, provider, providerId, JSON.stringify(identityData)]
      );

      // Update email_verified to true (OAuth login means email is trusted)
      await pool.query(
        'UPDATE _accounts SET email_verified = true WHERE id = $1 AND email_verified = false',
        [existingUser.id]
      );

      // Fetch updated user data with provider information
      const dbUser = await this.getUserById(existingUser.id);
      if (!dbUser) {
        throw new Error('User not found after linking OAuth provider');
      }

      const user = this.transformUserRecordToSchema(dbUser);
      const accessToken = this.tokenManager.generateToken({
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

    const pool = this.getPool();
    const client = await pool.connect();

    try {
      await client.query('BEGIN');

      // Create user record (without password for OAuth users)
      await client.query(
        `
        INSERT INTO _accounts (id, email, name, email_verified, created_at, updated_at)
        VALUES ($1, $2, $3, true, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
      `,
        [userId, email, userName]
      );

      await client.query(
        `
        INSERT INTO users (id, nickname, avatar_url, created_at, updated_at)
        VALUES ($1, $2, $3, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
      `,
        [userId, userName, avatarUrl]
      );

      // Create _account_providers record
      await client.query(
        `
        INSERT INTO _account_providers (
          user_id, provider, provider_account_id,
          provider_data, created_at, updated_at
        )
        VALUES ($1, $2, $3, $4, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
      `,
        [userId, provider, providerId, JSON.stringify({ ...identityData, avatar_url: avatarUrl })]
      );

      await client.query('COMMIT');

      const user: UserSchema = {
        id: userId,
        email,
        name: userName,
        emailVerified: true,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };

      const accessToken = this.tokenManager.generateToken({
        sub: userId,
        email,
        role: 'authenticated',
      });

      return { user, accessToken };
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
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
        return this.googleOAuthProvider.generateOAuthUrl(state);
      case 'github':
        return this.githubOAuthProvider.generateOAuthUrl(state);
      case 'discord':
        return this.discordOAuthProvider.generateOAuthUrl(state);
      case 'linkedin':
        return this.linkedinOAuthProvider.generateOAuthUrl(state);
      case 'facebook':
        return this.facebookOAuthProvider.generateOAuthUrl(state);
      case 'microsoft':
        return this.microsoftOAuthProvider.generateOAuthUrl(state);
      case 'x':
        return this.xOAuthProvider.generateOAuthUrl(state);
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
        userData = await this.googleOAuthProvider.handleCallback(payload);
        break;
      case 'github':
        userData = await this.githubOAuthProvider.handleCallback(payload);
        break;
      case 'discord':
        userData = await this.discordOAuthProvider.handleCallback(payload);
        break;
      case 'linkedin':
        userData = await this.linkedinOAuthProvider.handleCallback(payload);
        break;
      case 'facebook':
        userData = await this.facebookOAuthProvider.handleCallback(payload);
        break;
      case 'microsoft':
        userData = await this.microsoftOAuthProvider.handleCallback(payload);
        break;
      case 'x':
        userData = await this.xOAuthProvider.handleCallback(payload);
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
        userData = this.googleOAuthProvider.handleSharedCallback(payloadData);
        break;
      case 'github':
        userData = this.githubOAuthProvider.handleSharedCallback(payloadData);
        break;
      case 'discord':
        userData = this.discordOAuthProvider.handleSharedCallback(payloadData);
        break;
      case 'linkedin':
        userData = this.linkedinOAuthProvider.handleSharedCallback(payloadData);
        break;
      case 'facebook':
        userData = this.facebookOAuthProvider.handleSharedCallback(payloadData);
        break;
      case 'x':
        userData = this.xOAuthProvider.handleSharedCallback(payloadData);
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
   * Get user by email (helper method for internal use)
   * @private
   */
  private async getUserByEmail(email: string): Promise<UserRecord | null> {
    const pool = this.getPool();
    const result = await pool.query(
      `
      SELECT
        u.id,
        u.email,
        u.name,
        u.email_verified,
        u.created_at,
        u.updated_at,
        u.password,
        STRING_AGG(a.provider, ',') as providers
      FROM _accounts u
      LEFT JOIN _account_providers a ON u.id = a.user_id
      WHERE u.email = $1
      GROUP BY u.id
    `,
      [email]
    );

    return result.rows[0] || null;
  }

  /**
   * Get user by ID (helper method for internal use)
   * @private
   */
  private async getUserById(userId: string): Promise<UserRecord | null> {
    const pool = this.getPool();
    const result = await pool.query(
      `
      SELECT
        u.id,
        u.email,
        u.name,
        u.email_verified,
        u.created_at,
        u.updated_at,
        u.password,
        STRING_AGG(a.provider, ',') as providers
      FROM _accounts u
      LEFT JOIN _account_providers a ON u.id = a.user_id
      WHERE u.id = $1
      GROUP BY u.id
    `,
      [userId]
    );

    return result.rows[0] || null;
  }

  /**
   * Transform database user record to API response format (snake_case to camelCase + provider logic)
   * @private
   */
  private transformUserRecordToSchema(dbUser: UserRecord): UserSchema {
    const identities = [];
    const providers: string[] = [];

    // Add social providers if any
    if (dbUser.providers) {
      dbUser.providers.split(',').forEach((provider: string) => {
        identities.push({ provider });
        providers.push(provider);
      });
    }

    // Add email provider if password exists
    if (dbUser.password) {
      identities.push({ provider: 'email' });
      providers.push('email');
    }

    // Use first provider to determine type: 'email' or 'social'
    const firstProvider = providers[0];
    const providerType = firstProvider === 'email' ? 'email' : 'social';

    return {
      id: dbUser.id,
      email: dbUser.email,
      name: dbUser.name,
      emailVerified: dbUser.email_verified,
      createdAt: dbUser.created_at,
      updatedAt: dbUser.updated_at,
      identities: identities,
      providerType: providerType,
    };
  }

  /**
   * List users with pagination and search
   */
  async listUsers(
    limit: number,
    offset: number,
    search?: string
  ): Promise<{ users: UserSchema[]; total: number }> {
    const pool = this.getPool();
    let query = `
      SELECT
        u.id,
        u.email,
        u.name,
        u.email_verified,
        u.created_at,
        u.updated_at,
        u.password,
        STRING_AGG(a.provider, ',') as providers
      FROM _accounts u
      LEFT JOIN _account_providers a ON u.id = a.user_id
    `;
    const params: (string | number)[] = [];

    if (search) {
      query += ' WHERE u.email LIKE $1 OR u.name LIKE $2';
      params.push(`%${search}%`, `%${search}%`);
    }

    query += ` GROUP BY u.id ORDER BY u.created_at DESC LIMIT $${params.length + 1} OFFSET $${params.length + 2}`;
    params.push(limit, offset);

    const result = await pool.query(query, params);
    const dbUsers = result.rows as UserRecord[];

    // Transform users
    const users = dbUsers.map((dbUser) => this.transformUserRecordToSchema(dbUser));

    // Get total count
    let countQuery = 'SELECT COUNT(*) as count FROM _accounts';
    const countParams: string[] = [];
    if (search) {
      countQuery += ' WHERE email LIKE $1 OR name LIKE $2';
      countParams.push(`%${search}%`, `%${search}%`);
    }
    const countResult = await pool.query(countQuery, countParams);
    const count = countResult.rows[0].count;

    return {
      users,
      total: count,
    };
  }

  /**
   * Get user by ID (returns UserSchema for API)
   */
  async getUserSchemaById(userId: string): Promise<UserSchema | null> {
    const dbUser = await this.getUserById(userId);
    if (!dbUser) {
      return null;
    }
    return this.transformUserRecordToSchema(dbUser);
  }

  /**
   * Delete multiple users by IDs
   */
  async deleteUsers(userIds: string[]): Promise<number> {
    const pool = this.getPool();
    const placeholders = userIds.map((_, i) => `$${i + 1}`).join(',');
    const result = await pool.query(`DELETE FROM _accounts WHERE id IN (${placeholders})`, userIds);

    return result.rowCount || 0;
  }
}
