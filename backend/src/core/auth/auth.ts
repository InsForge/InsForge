import jwt from 'jsonwebtoken';
import bcrypt from 'bcryptjs';
import crypto from 'crypto';
import axios from 'axios';
import { OAuth2Client } from 'google-auth-library';
import dotenv from 'dotenv';
import { verifyCloudToken } from '@/utils/cloud-token.js';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import { DatabaseManager } from '@/core/database/manager.js';
import logger from '@/utils/logger.js';
import type {
  UserSchema,
  CreateUserResponse,
  CreateSessionResponse,
  CreateAdminSessionResponse,
  TokenPayloadSchema,
  AuthMetadataSchema,
} from '@insforge/shared-schemas';
import { OAuthConfigService } from './oauth';
import {
  GitHubEmailInfo,
  GitHubUserInfo,
  GoogleUserInfo,
  DiscordUserInfo,
  UserRecord,
} from '@/types/auth';
import { ADMIN_ID } from '@/utils/constants';
import { getApiBaseUrl } from '@/utils/environment';

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
  private processedCodes: Set<string>;
  private tokenCache: Map<string, { access_token: string; id_token: string }>;

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

    // Initialize OAuth helpers
    this.processedCodes = new Set();
    this.tokenCache = new Map();

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
      sub: 'anonymous',
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
      throw new Error('Invalid token');
    }
  }

  /**
   * User registration
   */
  async register(email: string, password: string, name?: string): Promise<CreateUserResponse> {
    const existingUser = await this.db
      .prepare('SELECT id FROM _accounts WHERE email = ?')
      .get(email);

    if (existingUser) {
      throw new Error('User already exists');
    }

    const hashedPassword = await bcrypt.hash(password, 10);
    const userId = crypto.randomUUID();

    await this.db
      .prepare(
        `
      INSERT INTO _accounts (id, email, password, name, email_verified, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, NOW(), NOW())
    `
      )
      .run(userId, email, hashedPassword, name || null, false);

    await this.db
      .prepare(
        `
      INSERT INTO users (id, nickname, created_at, updated_at)
      VALUES (?, ?, NOW(), NOW())
    `
      )
      .run(userId, name || null);

    const dbUser = await this.db
      .prepare(
        'SELECT id, email, name, email_verified, created_at, updated_at FROM _accounts WHERE id = ?'
      )
      .get(userId);
    const user = this.dbUserToApiUser(dbUser);
    const accessToken = this.generateToken({ sub: userId, email, role: 'authenticated' });

    return { user, accessToken };
  }

  /**
   * User login
   */
  async login(email: string, password: string): Promise<CreateSessionResponse> {
    const dbUser = await this.db.prepare('SELECT * FROM _accounts WHERE email = ?').get(email);

    if (!dbUser || !dbUser.password) {
      throw new Error('Invalid credentials');
    }

    const validPassword = await bcrypt.compare(password, dbUser.password);
    if (!validPassword) {
      throw new Error('Invalid credentials');
    }

    const user = this.dbUserToApiUser(dbUser);
    const accessToken = this.generateToken({
      sub: dbUser.id,
      email: dbUser.email,
      role: 'authenticated',
    });

    return { user, accessToken };
  }

  /**
   * Admin login (validates against env variables only)
   */
  adminLogin(email: string, password: string): CreateAdminSessionResponse {
    // Simply validate against environment variables
    if (email !== this.adminEmail || password !== this.adminPassword) {
      throw new Error('Invalid admin credentials');
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
      throw new Error('Invalid admin credentials');
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
    identityData: GoogleUserInfo | GitHubUserInfo | DiscordUserInfo | Record<string, unknown>
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

      const user = this.dbUserToApiUser(existingUser);
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
    identityData: GoogleUserInfo | GitHubUserInfo | DiscordUserInfo | Record<string, unknown>,
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

  /**
   * Generate Google OAuth authorization URL
   */
  async generateGoogleAuthUrl(state?: string): Promise<string | undefined> {
    const oauthConfigService = OAuthConfigService.getInstance();
    const config = await oauthConfigService.getConfigByProvider('google');

    if (!config) {
      throw new Error('Google OAuth not configured');
    }

    const selfBaseUrl = getApiBaseUrl();

    if (config?.useSharedKey) {
      if (!state) {
        logger.warn('Shared Google OAuth called without state parameter');
        throw new Error('State parameter is required for shared Google OAuth');
      }
      // Use shared keys if configured
      const cloudBaseUrl = process.env.CLOUD_API_HOST || 'https://api.insforge.dev';
      const redirectUri = `${selfBaseUrl}/api/auth/oauth/shared/callback/${state}`;
      const authUrl = await fetch(
        `${cloudBaseUrl}/auth/v1/shared/google?redirect_uri=${encodeURIComponent(redirectUri)}`,
        {
          method: 'GET',
          headers: {
            'Content-Type': 'application/json',
          },
        }
      );
      if (!authUrl.ok) {
        logger.error('Failed to fetch Google auth URL:', {
          status: authUrl.status,
          statusText: authUrl.statusText,
        });
        throw new Error(`Failed to fetch Google auth URL: ${authUrl.statusText}`);
      }
      const responseData = (await authUrl.json()) as { auth_url?: string; url?: string };
      return responseData.auth_url || responseData.url || '';
    }

    logger.debug('Google OAuth Config (fresh from DB):', {
      clientId: config.clientId ? 'SET' : 'NOT SET',
    });

    const authUrl = new URL('https://accounts.google.com/o/oauth2/v2/auth');
    authUrl.searchParams.set('client_id', config.clientId ?? '');
    authUrl.searchParams.set('redirect_uri', `${selfBaseUrl}/api/auth/oauth/google/callback`);
    authUrl.searchParams.set('response_type', 'code');
    authUrl.searchParams.set(
      'scope',
      config.scopes ? config.scopes.join(' ') : 'openid email profile'
    );
    authUrl.searchParams.set('access_type', 'offline');
    if (state) {
      authUrl.searchParams.set('state', state);
    }

    return authUrl.toString();
  }

  /**
   * Generate GitHub OAuth authorization URL - ALWAYS reads fresh from DB
   */
  async generateGitHubAuthUrl(state?: string): Promise<string> {
    const oauthConfigService = OAuthConfigService.getInstance();
    const config = await oauthConfigService.getConfigByProvider('github');

    if (!config) {
      throw new Error('GitHub OAuth not configured');
    }

    const selfBaseUrl = getApiBaseUrl();

    if (config?.useSharedKey) {
      if (!state) {
        logger.warn('Shared GitHub OAuth called without state parameter');
        throw new Error('State parameter is required for shared GitHub OAuth');
      }
      // Use shared keys if configured
      const cloudBaseUrl = process.env.CLOUD_API_HOST || 'https://api.insforge.dev';
      const redirectUri = `${selfBaseUrl}/api/auth/oauth/shared/callback/${state}`;
      const authUrl = await fetch(
        `${cloudBaseUrl}/auth/v1/shared/github?redirect_uri=${encodeURIComponent(redirectUri)}`,
        {
          method: 'GET',
          headers: {
            'Content-Type': 'application/json',
          },
        }
      );
      if (!authUrl.ok) {
        logger.error('Failed to fetch GitHub auth URL:', {
          status: authUrl.status,
          statusText: authUrl.statusText,
        });
        throw new Error(`Failed to fetch GitHub auth URL: ${authUrl.statusText}`);
      }
      const responseData = (await authUrl.json()) as { auth_url?: string; url?: string };
      return responseData.auth_url || responseData.url || '';
    }

    logger.debug('GitHub OAuth Config (fresh from DB):', {
      clientId: config.clientId ? 'SET' : 'NOT SET',
    });

    const authUrl = new URL('https://github.com/login/oauth/authorize');
    authUrl.searchParams.set('client_id', config.clientId ?? '');
    authUrl.searchParams.set('redirect_uri', `${selfBaseUrl}/api/auth/oauth/github/callback`);
    authUrl.searchParams.set('scope', config.scopes ? config.scopes.join(' ') : 'user:email');
    if (state) {
      authUrl.searchParams.set('state', state);
    }

    return authUrl.toString();
  }

  /**
   * Generate Discord OAuth authorization URL
   */
  async generateDiscordAuthUrl(state?: string): Promise<string> {
    const oauthConfigService = OAuthConfigService.getInstance();
    const config = await oauthConfigService.getConfigByProvider('discord');

    if (!config) {
      throw new Error('Discord OAuth not configured');
    }

    const selfBaseUrl = getApiBaseUrl();

    if (config?.useSharedKey) {
      if (!state) {
        logger.warn('Shared Discord OAuth called without state parameter');
        throw new Error('State parameter is required for shared Discord OAuth');
      }
      // Use shared keys if configured
      const cloudBaseUrl = process.env.CLOUD_API_HOST || 'https://api.insforge.dev';
      const redirectUri = `${selfBaseUrl}/api/auth/oauth/shared/callback/${state}`;
      const authUrl = await fetch(
        `${cloudBaseUrl}/auth/v1/shared/discord?redirect_uri=${encodeURIComponent(redirectUri)}`,
        {
          method: 'GET',
          headers: {
            'Content-Type': 'application/json',
          },
        }
      );
      if (!authUrl.ok) {
        logger.error('Failed to fetch Discord auth URL:', {
          status: authUrl.status,
          statusText: authUrl.statusText,
        });
        throw new Error(`Failed to fetch Discord auth URL: ${authUrl.statusText}`);
      }
      const responseData = (await authUrl.json()) as { auth_url?: string; url?: string };
      return responseData.auth_url || responseData.url || '';
    }

    logger.debug('Discord OAuth Config (fresh from DB):', {
      clientId: config.clientId ? 'SET' : 'NOT SET',
    });

    const authUrl = new URL('https://discord.com/api/oauth2/authorize');
    authUrl.searchParams.set('client_id', config.clientId ?? '');
    authUrl.searchParams.set('redirect_uri', `${selfBaseUrl}/api/auth/oauth/discord/callback`);
    authUrl.searchParams.set('response_type', 'code');
    authUrl.searchParams.set('scope', config.scopes ? config.scopes.join(' ') : 'identify email');
    if (state) {
      authUrl.searchParams.set('state', state);
    }

    return authUrl.toString();
  }

  /**
   * Exchange Google code for tokens
   */
  async exchangeCodeToTokenByGoogle(
    code: string
  ): Promise<{ access_token: string; id_token: string }> {
    // Check cache first
    if (this.processedCodes.has(code)) {
      const cachedTokens = this.tokenCache.get(code);
      if (cachedTokens) {
        logger.debug('Returning cached tokens for already processed code.');
        return cachedTokens;
      }
      throw new Error('Authorization code is currently being processed.');
    }

    const oauthConfigService = OAuthConfigService.getInstance();
    const config = await oauthConfigService.getConfigByProvider('google');

    if (!config) {
      throw new Error('Google OAuth not configured');
    }

    try {
      this.processedCodes.add(code);

      logger.info('Exchanging Google code for tokens', {
        hasCode: !!code,
        clientId: config.clientId?.substring(0, 10) + '...',
      });

      const clientSecret = await oauthConfigService.getClientSecretByProvider('google');
      const selfBaseUrl = getApiBaseUrl();
      const response = await axios.post('https://oauth2.googleapis.com/token', {
        code,
        client_id: config.clientId,
        client_secret: clientSecret,
        redirect_uri: `${selfBaseUrl}/api/auth/oauth/google/callback`,
        grant_type: 'authorization_code',
      });

      if (!response.data.access_token || !response.data.id_token) {
        throw new Error('Failed to get tokens from Google');
      }

      const result = {
        access_token: response.data.access_token,
        id_token: response.data.id_token,
      };

      // Cache the successful token exchange
      this.tokenCache.set(code, result);

      // Set a timeout to clear the code and cache to prevent memory leaks
      setTimeout(() => {
        this.processedCodes.delete(code);
        this.tokenCache.delete(code);
      }, 60000); // 1 minute timeout

      return result;
    } catch (error) {
      // If the request fails, remove the code immediately to allow for a retry
      this.processedCodes.delete(code);

      if (axios.isAxiosError(error) && error.response) {
        logger.error('Google token exchange failed', {
          status: error.response.status,
          error: error.response.data,
        });
        throw new Error(`Google OAuth error: ${JSON.stringify(error.response.data)}`);
      }
      throw error;
    }
  }

  /**
   * Verify Google ID token and get user info
   */
  async verifyGoogleToken(idToken: string) {
    const oauthConfigService = OAuthConfigService.getInstance();
    const config = await oauthConfigService.getConfigByProvider('google');

    if (!config) {
      throw new Error('Google OAuth not configured');
    }

    const clientSecret = await oauthConfigService.getClientSecretByProvider('google');

    if (!clientSecret) {
      throw new Error('Google Client Secret not conifgured.');
    }

    // Create OAuth2Client with fresh config
    const googleClient = new OAuth2Client(config.clientId, clientSecret, config.redirectUri);

    try {
      // Properly verify the ID token with Google's servers
      const ticket = await googleClient.verifyIdToken({
        idToken,
        audience: config.clientId,
      });

      const payload = ticket.getPayload();
      if (!payload) {
        throw new Error('Invalid Google token payload');
      }

      return {
        sub: payload.sub,
        email: payload.email || '',
        email_verified: payload.email_verified || false,
        name: payload.name || '',
        picture: payload.picture || '',
        given_name: payload.given_name || '',
        family_name: payload.family_name || '',
        locale: payload.locale || '',
      };
    } catch (error) {
      logger.error('Google token verification failed:', error);
      throw new Error(`Google token verification failed: ${error}`);
    }
  }

  /**
   * Find or create Google user
   */
  async findOrCreateGoogleUser(googleUserInfo: GoogleUserInfo): Promise<CreateSessionResponse> {
    const userName = googleUserInfo.name || googleUserInfo.email.split('@')[0];
    return this.findOrCreateThirdPartyUser(
      'google',
      googleUserInfo.sub,
      googleUserInfo.email,
      userName,
      googleUserInfo.picture || '',
      googleUserInfo
    );
  }

  /**
   * Exchange GitHub code for access token
   */
  async exchangeGitHubCodeForToken(code: string): Promise<string> {
    const oauthConfigService = OAuthConfigService.getInstance();
    const config = await oauthConfigService.getConfigByProvider('github');

    if (!config) {
      throw new Error('GitHub OAuth not configured');
    }

    const clientSecret = await oauthConfigService.getClientSecretByProvider('github');
    const selfBaseUrl = getApiBaseUrl();
    const response = await axios.post(
      'https://github.com/login/oauth/access_token',
      {
        client_id: config.clientId,
        client_secret: clientSecret,
        code,
        redirect_uri: `${selfBaseUrl}/api/auth/oauth/github/callback`,
      },
      {
        headers: {
          Accept: 'application/json',
        },
      }
    );

    if (!response.data.access_token) {
      throw new Error('Failed to get access token from GitHub');
    }

    return response.data.access_token;
  }

  /**
   * Get GitHub user info
   */
  async getGitHubUserInfo(accessToken: string) {
    const userResponse = await axios.get('https://api.github.com/user', {
      headers: {
        Authorization: `Bearer ${accessToken}`,
      },
    });

    // GitHub doesn't always return email in user endpoint
    let email = userResponse.data.email;

    if (!email) {
      const emailResponse = await axios.get('https://api.github.com/user/emails', {
        headers: {
          Authorization: `Bearer ${accessToken}`,
        },
      });

      const primaryEmail = emailResponse.data.find((e: GitHubEmailInfo) => e.primary);
      email = primaryEmail ? primaryEmail.email : emailResponse.data[0]?.email;
    }

    return {
      id: userResponse.data.id,
      login: userResponse.data.login,
      name: userResponse.data.name,
      email: email || `${userResponse.data.login}@users.noreply.github.com`,
      avatar_url: userResponse.data.avatar_url,
    };
  }

  /**
   * Find or create GitHub user
   */
  async findOrCreateGitHubUser(githubUserInfo: GitHubUserInfo): Promise<CreateSessionResponse> {
    const userName = githubUserInfo.name || githubUserInfo.login;
    const email = githubUserInfo.email || `${githubUserInfo.login}@users.noreply.github.com`;

    return this.findOrCreateThirdPartyUser(
      'github',
      githubUserInfo.id.toString(),
      email,
      userName,
      githubUserInfo.avatar_url || '',
      githubUserInfo
    );
  }

  /**
   * Exchange Discord code for access token
   */
  async exchangeDiscordCodeForToken(code: string): Promise<string> {
    const oauthConfigService = OAuthConfigService.getInstance();
    const config = await oauthConfigService.getConfigByProvider('discord');

    if (!config) {
      throw new Error('Discord OAuth not configured');
    }

    const clientSecret = await oauthConfigService.getClientSecretByProvider('discord');
    const selfBaseUrl = getApiBaseUrl();
    const response = await axios.post(
      'https://discord.com/api/oauth2/token',
      new URLSearchParams({
        client_id: config.clientId ?? '',
        client_secret: clientSecret ?? '',
        code,
        redirect_uri: `${selfBaseUrl}/api/auth/oauth/discord/callback`,
        grant_type: 'authorization_code',
      }).toString(),
      {
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
        },
      }
    );

    if (!response.data.access_token) {
      throw new Error('Failed to get access token from Discord');
    }

    return response.data.access_token;
  }

  /**
   * Get Discord user info
   */
  async getDiscordUserInfo(accessToken: string) {
    const response = await axios.get('https://discord.com/api/users/@me', {
      headers: {
        Authorization: `Bearer ${accessToken}`,
      },
    });

    return {
      id: response.data.id,
      username: response.data.username,
      email: response.data.email,
      avatar: response.data.avatar
        ? `https://cdn.discordapp.com/avatars/${response.data.id}/${response.data.avatar}.png`
        : '',
    };
  }

  /**
   * Find or create Discord user
   */
  async findOrCreateDiscordUser(discordUserInfo: DiscordUserInfo): Promise<CreateSessionResponse> {
    const userName = discordUserInfo.username;
    const email = discordUserInfo.email || `${discordUserInfo.id}@users.noreply.discord.local`;

    return this.findOrCreateThirdPartyUser(
      'discord',
      discordUserInfo.id,
      email,
      userName,
      discordUserInfo.avatar || '',
      discordUserInfo
    );
  }

  async getMetadata(): Promise<AuthMetadataSchema> {
    const oAuthConfigService = OAuthConfigService.getInstance();
    const oAuthConfigs = await oAuthConfigService.getAllConfigs();
    return {
      oauths: oAuthConfigs,
    };
  }

  /**
   * Get database instance for direct queries
   */
  getDb() {
    return this.db;
  }
}
