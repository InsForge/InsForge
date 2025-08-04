import jwt from 'jsonwebtoken';
import crypto from 'crypto';
import { v4 as uuidv4 } from 'uuid';
import { OAuth2Client } from 'google-auth-library';
import axios from 'axios';
import {
  DatabaseManager,
  Auth,
  SuperUserAuth,
  SuperUserProfile,
  Identifies,
} from '@/core/database/database.js';
import { ProfileRecord, UserWithProfile } from '@/types/profile.js';
import { OAuthConfig, ConfigRecord } from '@/types/auth.js';
import bcrypt from 'bcrypt';
import logger from '@/utils/logger.js';

const JWT_SECRET = process.env.JWT_SECRET || 'your-secret-key-here';
const JWT_EXPIRES_IN = '7d';

// Google OAuth configuration
const GOOGLE_CLIENT_ID = process.env.GOOGLE_CLIENT_ID;
const GOOGLE_CLIENT_SECRET = process.env.GOOGLE_CLIENT_SECRET;
const GOOGLE_REDIRECT_URI = process.env.GOOGLE_REDIRECT_URI;

// GitHub OAuth configuration
const GITHUB_CLIENT_ID = process.env.GITHUB_CLIENT_ID;
// const GITHUB_CLIENT_SECRET = process.env.GITHUB_CLIENT_SECRET; // Not used directly, loaded from config
const GITHUB_REDIRECT_URI = process.env.GITHUB_REDIRECT_URI;

export interface TokenPayload {
  sub: string;
  email: string;
  type: 'user' | 'admin';
  role?: string;
}

export interface GoogleUserInfo {
  sub: string; // Google's unique user ID
  email: string;
  email_verified: boolean;
  name: string;
  given_name: string;
  family_name: string;
  picture: string;
  locale: string;
}

export interface GitHubUserInfo {
  id: number; // GitHub's unique user ID
  login: string; // Username
  name: string | null;
  email: string | null;
  avatar_url: string;
  bio: string | null;
}

export class AuthService {
  private static instance: AuthService;
  private googleClient: OAuth2Client;
  private processedCodes: Set<string>;
  private tokenCache: Map<string, { access_token: string; id_token: string }>;
  private oauthConfig: OAuthConfig | null = null;
  private configLoadTime: number = 0;
  private CONFIG_CACHE_TTL = 60000; // 1 minute cache

  private constructor() {
    // Log environment variables only once during initialization
    logger.info('AuthService initialized - OAuth configuration', {
      googleOAuth: GOOGLE_CLIENT_ID ? 'Configured' : 'Not configured',
      githubOAuth: GITHUB_CLIENT_ID ? 'Configured' : 'Not configured',
    });

    this.googleClient = new OAuth2Client(
      GOOGLE_CLIENT_ID,
      GOOGLE_CLIENT_SECRET,
      GOOGLE_REDIRECT_URI
    );
    this.processedCodes = new Set();
    this.tokenCache = new Map();
  }

  public static getInstance(): AuthService {
    if (!AuthService.instance) {
      AuthService.instance = new AuthService();
    }
    return AuthService.instance;
  }

  private getDb() {
    const dbManager = DatabaseManager.getInstance();
    return dbManager.getDb();
  }

  // Load OAuth configuration from database with caching
  private async loadOAuthConfig(): Promise<OAuthConfig> {
    const now = Date.now();
    if (this.oauthConfig && now - this.configLoadTime < this.CONFIG_CACHE_TTL) {
      return this.oauthConfig;
    }

    const db = this.getDb();
    let configRows: ConfigRecord[];
    try {
      const rows = await db
        .prepare(
          `
        SELECT key, value FROM _config WHERE key LIKE 'auth.oauth.provider.%'
      `
        )
        .all();

      // Validate the result is an array
      if (!Array.isArray(rows)) {
        throw new Error('Expected array from database query');
      }

      // Validate each row has the expected structure
      configRows = rows.map((row) => {
        if (
          typeof row !== 'object' ||
          !row ||
          typeof row.key !== 'string' ||
          typeof row.value !== 'string'
        ) {
          throw new Error(`Invalid config row structure: ${JSON.stringify(row)}`);
        }
        return row as ConfigRecord;
      });
    } catch (error) {
      logger.error('Failed to load OAuth config from database', {
        error: error instanceof Error ? error.message : String(error),
      });
      // Return default config on error
      configRows = [];
    }

    const config: OAuthConfig = {
      google: {
        clientId: '',
        clientSecret: '',
        redirectUri: GOOGLE_REDIRECT_URI || '',
        enabled: false,
      },
      github: {
        clientId: '',
        clientSecret: '',
        redirectUri: GITHUB_REDIRECT_URI || '',
        enabled: false,
      },
    };

    // Load from database values only
    for (const row of configRows) {
      try {
        const provider =
          row.key === 'auth.oauth.provider.google'
            ? 'google'
            : row.key === 'auth.oauth.provider.github'
              ? 'github'
              : null;

        if (provider && config[provider]) {
          let value;
          try {
            value = JSON.parse(row.value);
          } catch (parseError) {
            logger.error('Failed to parse JSON for config key', {
              key: row.key,
              error: parseError instanceof Error ? parseError.message : String(parseError),
            });
            continue; // Skip this config entry
          }

          // Validate parsed value is an object
          if (typeof value !== 'object' || !value) {
            logger.error(`Invalid config value for ${row.key}: expected object`);
            continue;
          }

          config[provider].clientId = typeof value.clientId === 'string' ? value.clientId : '';
          config[provider].clientSecret =
            typeof value.clientSecret === 'string' ? value.clientSecret : '';
          config[provider].enabled = typeof value.enabled === 'boolean' ? value.enabled : false;
        }
      } catch (e) {
        logger.error('Failed to process OAuth config row', {
          key: row.key,
          error: e instanceof Error ? e.message : String(e),
        });
      }
    }

    this.oauthConfig = config;
    this.configLoadTime = now;

    // Update Google client with new config
    if (config.google.clientId && config.google.clientSecret) {
      this.googleClient = new OAuth2Client(
        config.google.clientId,
        config.google.clientSecret,
        config.google.redirectUri
      );
    }

    return config;
  }

  // Use bcrypt for salted hashing
  async hashPassword(password: string): Promise<string> {
    const saltRounds = 10;
    return await bcrypt.hash(password, saltRounds);
  }

  // Validate password
  async comparePassword(password: string, hash: string): Promise<boolean> {
    return await bcrypt.compare(password, hash);
  }

  generateToken(payload: TokenPayload): string {
    return jwt.sign(payload, JWT_SECRET, { expiresIn: JWT_EXPIRES_IN });
  }

  verifyToken(token: string): TokenPayload {
    return jwt.verify(token, JWT_SECRET) as TokenPayload;
  }

  generateApiKey(): string {
    return `ik_${crypto.randomBytes(32).toString('hex')}`;
  }

  // Create user with separated auth and profile
  async createUser(
    email: string,
    password: string,
    name?: string,
    customId?: string
  ): Promise<UserWithProfile> {
    const db = this.getDb();
    const authId = customId || uuidv4();
    const profileId = uuidv4();
    const passwordHash = await this.hashPassword(password);
    const userName = name || email.split('@')[0]; // Use email prefix as default name

    // Start transaction
    await db.exec('BEGIN');

    try {
      // Create auth record
      await db
        .prepare(
          `
        INSERT INTO _auth (id, email, password_hash)
        VALUES (?, ?, ?)
      `
        )
        .run(authId, email, passwordHash);

      // Create profile record
      await db
        .prepare(
          `
        INSERT INTO _profiles (id, auth_id, name)
        VALUES (?, ?, ?)
      `
        )
        .run(profileId, authId, userName);

      await db.exec('COMMIT');

      const user = await this.getUserWithProfile(authId);
      if (!user) {
        throw new Error('Failed to create user');
      }
      return user;
    } catch (error) {
      await db.exec('ROLLBACK');
      throw error;
    }
  }

  // Create superuser with separated auth and profile
  async createSuperUser(
    email: string,
    password: string,
    name?: string
  ): Promise<SuperUserAuth & { profile: SuperUserProfile }> {
    const db = this.getDb();
    const authId = uuidv4();
    const profileId = uuidv4();
    const passwordHash = await this.hashPassword(password);
    const userName = name || email.split('@')[0];

    await db.exec('BEGIN');

    try {
      // Create superuser auth record
      await db
        .prepare(
          `
        INSERT INTO _superuser_auth (id, email, password_hash)
        VALUES (?, ?, ?)
      `
        )
        .run(authId, email, passwordHash);

      // Create superuser profile record
      await db
        .prepare(
          `
        INSERT INTO _superuser_profiles (id, auth_id, name)
        VALUES (?, ?, ?)
      `
        )
        .run(profileId, authId, userName);

      await db.exec('COMMIT');

      const superuser = await this.getSuperUserWithProfile(authId);
      if (!superuser) {
        throw new Error('Failed to create superuser');
      }

      return superuser;
    } catch (error) {
      await db.exec('ROLLBACK');
      throw error;
    }
  }

  async authenticateUser(email: string, password: string): Promise<UserWithProfile | null> {
    const db = this.getDb();
    let auth: Auth | null;

    try {
      const result = await db
        .prepare(
          `
        SELECT * FROM _auth WHERE email = ?
      `
        )
        .get(email);

      // Validate the result structure if not null
      if (result) {
        if (typeof result !== 'object' || !result.id || !result.email || !result.password_hash) {
          throw new Error('Invalid auth record structure');
        }
      }

      auth = result as Auth | null;
    } catch (error) {
      logger.error('Failed to authenticate user', {
        error: error instanceof Error ? error.message : String(error),
      });
      throw new Error(`Database error during authentication: ${error}`);
    }

    if (!auth) {
      return null;
    }
    const isMatch = await this.comparePassword(password, auth.password_hash);
    if (!isMatch) {
      return null;
    }
    return this.getUserWithProfile(auth.id);
  }

  // Separate superuser authentication - only for dashboard access
  async authenticateSuperUser(
    email: string,
    password: string
  ): Promise<(SuperUserAuth & { profile: SuperUserProfile }) | null> {
    const db = this.getDb();
    let auth: SuperUserAuth | null;

    try {
      const result = await db
        .prepare(
          `
        SELECT * FROM _superuser_auth WHERE email = ?
      `
        )
        .get(email);

      // Validate the result structure if not null
      if (result) {
        if (typeof result !== 'object' || !result.id || !result.email || !result.password_hash) {
          throw new Error('Invalid superuser auth record structure');
        }
      }

      auth = result as SuperUserAuth | null;
    } catch (error) {
      logger.error('Failed to authenticate superuser', {
        error: error instanceof Error ? error.message : String(error),
      });
      throw new Error(`Database error during superuser authentication: ${error}`);
    }

    if (!auth) {
      return null;
    }
    const isMatch = await this.comparePassword(password, auth.password_hash);
    if (!isMatch) {
      return null;
    }
    return this.getSuperUserWithProfile(auth.id);
  }

  // Get user with profile data
  async getUserWithProfile(authId: string): Promise<UserWithProfile | null> {
    const db = this.getDb();

    const auth = (await db
      .prepare(
        `
      SELECT * FROM _auth WHERE id = ?
    `
      )
      .get(authId)) as Auth | null;

    if (!auth) {
      return null;
    }

    const profile = (await db
      .prepare(
        `
      SELECT * FROM _profiles WHERE auth_id = ?
    `
      )
      .get(authId)) as ProfileRecord | null;

    // identities field
    const identities = (await db
      .prepare(
        `
      SELECT auth_id, provider, last_login_at FROM _identifies WHERE auth_id = ?
    `
      )
      .all(authId)) as Identifies[];

    return {
      ...auth,
      profile: profile as ProfileRecord,
      identities: identities as Identifies[],
    };
  }

  // Get superuser with profile data
  async getSuperUserWithProfile(
    authId: string
  ): Promise<(SuperUserAuth & { profile: SuperUserProfile }) | null> {
    const db = this.getDb();

    const auth = (await db
      .prepare(
        `
      SELECT * FROM _superuser_auth WHERE id = ?
    `
      )
      .get(authId)) as SuperUserAuth | null;

    if (!auth) {
      return null;
    }

    const profile = (await db
      .prepare(
        `
      SELECT * FROM _superuser_profiles WHERE auth_id = ?
    `
      )
      .get(authId)) as SuperUserProfile | null;

    if (!profile) {
      return null;
    }

    return {
      ...auth,
      profile,
    };
  }

  async getUserById(id: string): Promise<UserWithProfile | null> {
    return this.getUserWithProfile(id);
  }

  async getUserByEmail(email: string): Promise<UserWithProfile | null> {
    const db = this.getDb();
    const auth = (await db
      .prepare(
        `
      SELECT * FROM _auth WHERE email = ?
    `
      )
      .get(email)) as Auth | null;

    if (!auth) {
      return null;
    }

    return this.getUserWithProfile(auth.id);
  }

  async getAllUsers(): Promise<UserWithProfile[]> {
    const db = this.getDb();
    const users: UserWithProfile[] = [];

    const authRecords = (await db
      .prepare(
        `
      SELECT * FROM _auth ORDER BY created_at DESC
    `
      )
      .all()) as Auth[];

    for (const auth of authRecords) {
      const profile = (await db
        .prepare(
          `
        SELECT * FROM _profiles WHERE auth_id = ?
      `
        )
        .get(auth.id)) as ProfileRecord | null;

      const identities = (await db
        .prepare(
          `
        SELECT auth_id, provider, last_login_at FROM _identifies WHERE auth_id = ?
      `
        )
        .all(auth.id)) as Identifies[];

      if (profile || identities.length > 0) {
        users.push({
          ...auth,
          profile: profile as ProfileRecord,
          identities: identities as Identifies[],
        });
      }
    }

    return users;
  }

  async getUsersWithPagination(
    offset: number,
    limit: number,
    searchQuery?: string
  ): Promise<UserWithProfile[]> {
    const db = this.getDb();
    const users: UserWithProfile[] = [];

    let query = `
      SELECT a.* FROM _auth a
      LEFT JOIN _profiles p ON a.id = p.auth_id
    `;
    const params: (string | number)[] = [];

    if (searchQuery && searchQuery.trim()) {
      query += ` WHERE (a.email LIKE ? OR p.name LIKE ?)`;
      const searchPattern = `%${searchQuery.trim()}%`;
      params.push(searchPattern, searchPattern);
    }

    query += ` ORDER BY a.created_at DESC LIMIT ? OFFSET ?`;
    params.push(limit, offset);

    const authRecords = (await db.prepare(query).all(...params)) as Auth[];
    for (const auth of authRecords) {
      const profile = (await db
        .prepare(
          `
        SELECT * FROM _profiles WHERE auth_id = ?
      `
        )
        .get(auth.id)) as ProfileRecord | null;
      const identities = (await db
        .prepare(
          `
        SELECT auth_id, provider, last_login_at FROM _identifies WHERE auth_id = ?
      `
        )
        .all(auth.id)) as Identifies[];
      if (profile || identities.length > 0) {
        users.push({
          ...auth,
          profile: profile as ProfileRecord,
          identities: identities as Identifies[],
        });
      }
    }
    return users;
  }

  async getUsersCount(searchQuery?: string): Promise<number> {
    const db = this.getDb();

    let query = `
      SELECT COUNT(*) as count FROM _auth a
      LEFT JOIN _profiles p ON a.id = p.auth_id
    `;
    const params: string[] = [];

    if (searchQuery && searchQuery.trim()) {
      query += ` WHERE (a.email LIKE ? OR p.name LIKE ?)`;
      const searchPattern = `%${searchQuery.trim()}%`;
      params.push(searchPattern, searchPattern);
    }

    const row = await db.prepare(query).get(...params);
    return row.count || 0;
  }

  async bulkDeleteUsers(userIds: string[]): Promise<number> {
    const db = this.getDb();
    let deletedCount = 0;

    // Start transaction
    await db.exec('BEGIN');

    try {
      for (const userId of userIds) {
        // First delete related records
        // Delete from identifies table
        await db.prepare(`DELETE FROM _identifies WHERE auth_id = ?`).run(userId);

        // Delete from profiles table
        await db.prepare(`DELETE FROM _profiles WHERE auth_id = ?`).run(userId);

        // Finally delete from auth table
        const authResult = await db.prepare(`DELETE FROM _auth WHERE id = ?`).run(userId);

        // Only count as deleted if the auth record was actually deleted
        if (authResult.changes > 0) {
          deletedCount++;
        }
      }

      // Commit transaction
      await db.exec('COMMIT');
      return deletedCount;
    } catch (error) {
      // Rollback on error
      await db.exec('ROLLBACK');
      throw error;
    }
  }

  async getSuperUserById(
    id: string
  ): Promise<(SuperUserAuth & { profile: SuperUserProfile }) | null> {
    return this.getSuperUserWithProfile(id);
  }

  async getSuperUserByEmail(
    email: string
  ): Promise<(SuperUserAuth & { profile: SuperUserProfile }) | null> {
    const db = this.getDb();
    const auth = (await db
      .prepare(
        `
      SELECT * FROM _superuser_auth WHERE email = ?
    `
      )
      .get(email)) as SuperUserAuth | null;

    if (!auth) {
      return null;
    }

    return this.getSuperUserWithProfile(auth.id);
  }

  // Single API key verification - compares against stored key
  async verifyApiKey(apiKey: string): Promise<boolean> {
    const dbManager = DatabaseManager.getInstance();
    const storedApiKey = await dbManager.getApiKey();
    return storedApiKey === apiKey;
  }

  // Generate and store the single API key
  async initializeApiKey(): Promise<string> {
    const dbManager = DatabaseManager.getInstance();
    let apiKey = await dbManager.getApiKey();

    if (!apiKey) {
      // Generate new API key if none exists
      apiKey = this.generateApiKey();
      await dbManager.setApiKey(apiKey);
    }

    return apiKey;
  }

  // Generate Google OAuth authorization URL
  async generateGoogleAuthUrl(state?: string): Promise<string> {
    const config = await this.loadOAuthConfig();

    // Check if Google OAuth is properly configured
    if (!config.google.clientId) {
      throw new Error('Google OAuth Client ID environment variable is not set');
    }
    if (!config.google.clientSecret) {
      throw new Error('Google OAuth Client Secret environment variable is not set');
    }
    if (!config.google.redirectUri) {
      throw new Error('Google OAuth Redirect URI environment variable is not set');
    }

    logger.info('Google OAuth Config', {
      clientId: config.google.clientId ? 'SET' : 'NOT SET',
      clientSecret: config.google.clientSecret ? 'SET' : 'NOT SET',
      redirectUri: config.google.redirectUri,
      enabled: config.google.enabled,
      state: state,
    });

    const authUrlOptions: {
      access_type: string;
      scope: string[];
      redirect_uri: string;
      state?: string;
    } = {
      access_type: 'offline',
      scope: [
        'openid',
        'https://www.googleapis.com/auth/userinfo.profile',
        'https://www.googleapis.com/auth/userinfo.email',
      ],
      redirect_uri: config.google.redirectUri,
    };

    // Add state parameter if provided
    if (state) {
      authUrlOptions.state = state;
    }

    return this.googleClient.generateAuthUrl(authUrlOptions);
  }

  // Google OAuth methods
  async verifyGoogleToken(idToken: string): Promise<GoogleUserInfo> {
    try {
      const ticket = await this.googleClient.verifyIdToken({
        idToken,
        audience: this.googleClient._clientId || GOOGLE_CLIENT_ID,
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
        given_name: payload.given_name || '',
        family_name: payload.family_name || '',
        picture: payload.picture || '',
        locale: payload.locale || '',
      };
    } catch (error) {
      throw new Error(`Google token verification failed: ${error}`);
    }
  }

  async exchangeCodeToTokenByGoogle(
    code: string
  ): Promise<{ access_token: string; id_token: string }> {
    if (this.processedCodes.has(code)) {
      const cachedTokens = this.tokenCache.get(code);
      if (cachedTokens) {
        logger.info('Returning cached tokens for already processed code');
        return cachedTokens;
      }
      throw new Error('Authorization code is currently being processed.');
    }

    try {
      this.processedCodes.add(code);

      const { tokens } = await this.googleClient.getToken(code);

      if (!tokens.access_token || !tokens.id_token) {
        throw new Error('Failed to get access token or ID token from Google');
      }

      const result = {
        access_token: tokens.access_token,
        id_token: tokens.id_token,
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
      // If the request fails, remove the code immediately to allow for a retry if needed
      this.processedCodes.delete(code);
      throw new Error(`Failed to exchange code for token: ${error}`);
    }
  }

  async findOrCreateGoogleUser(googleUserInfo: GoogleUserInfo): Promise<UserWithProfile> {
    const userName =
      googleUserInfo.name || googleUserInfo.given_name || googleUserInfo.email.split('@')[0];
    return this.findOrCreateThirdPartyUser(
      'google',
      googleUserInfo.sub,
      googleUserInfo.email,
      userName,
      googleUserInfo.picture,
      googleUserInfo
    );
  }

  async findOrCreateThirdPartyUser(
    provider: string,
    providerId: string,
    email: string,
    userName: string,
    avatarUrl: string,
    identityData: GoogleUserInfo | GitHubUserInfo
  ): Promise<UserWithProfile> {
    const db = this.getDb();

    // First, try to find existing user by Google provider ID in identifies table
    let identify: Identifies | null;
    try {
      const result = await db
        .prepare(
          `
        SELECT * FROM _identifies WHERE provider = ? AND provider_id = ?
      `
        )
        .get(provider, providerId);

      // Validate the result structure if not null
      if (result) {
        if (typeof result !== 'object' || !result.auth_id || typeof result.auth_id !== 'string') {
          throw new Error('Invalid identifies record structure');
        }
      }

      identify = result as Identifies | null;
    } catch (error) {
      logger.error('Failed to query identifies table', {
        error: error instanceof Error ? error.message : String(error),
      });
      throw new Error(`Database error while checking existing user: ${error}`);
    }

    if (identify) {
      // Found existing OAuth user, update last login time
      await db
        .prepare(
          `
        UPDATE _identifies SET last_login_at = CURRENT_TIMESTAMP WHERE auth_id = ?
      `
        )
        .run(identify.auth_id);

      const user = await this.getUserWithProfile(identify.auth_id);
      if (!user) {
        throw new Error('Failed to get user profile after login update');
      }
      return user;
    }

    // If not found by provider_id, try to find by email in auth table
    const auth = (await db
      .prepare(
        `
      SELECT * FROM _auth WHERE email = ?
    `
      )
      .get(email)) as Auth | null;

    if (auth) {
      // Found existing user by email, create identifies record
      await db
        .prepare(
          `
        INSERT INTO _identifies (auth_id, provider, provider_id, identity_data, email, last_login_at)
        VALUES (?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
      `
        )
        .run(auth.id, provider, providerId, JSON.stringify(identityData), email);

      const user = await this.getUserWithProfile(auth.id);
      if (!user) {
        throw new Error('Failed to get user profile after provider association');
      }
      return user;
    }

    // Create new user with Google OAuth data
    return this.createThirdPartyUser(
      provider,
      userName,
      email,
      providerId,
      identityData,
      avatarUrl
    );
  }

  private async createThirdPartyUser(
    provider: string,
    userName: string,
    email: string,
    providerId: string,
    identityData: GoogleUserInfo | GitHubUserInfo,
    avatarUrl: string
  ): Promise<UserWithProfile> {
    const db = this.getDb();
    const authId = uuidv4();
    const profileId = uuidv4();

    await db.exec('BEGIN');

    try {
      // Create auth record (without password for OAuth users)
      await db
        .prepare(
          `
        INSERT INTO _auth (id, email, password_hash)
        VALUES (?, ?, ?)
      `
        )
        .run(authId, email, ''); // Empty password for OAuth users

      // Create identifies record
      await db
        .prepare(
          `
        INSERT INTO _identifies (auth_id, provider, provider_id, identity_data, email, last_login_at)
        VALUES (?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
      `
        )
        .run(authId, provider, providerId, JSON.stringify(identityData), email);

      // Create profile record
      await db
        .prepare(
          `
        INSERT INTO _profiles (id, auth_id, name, avatar_url)
        VALUES (?, ?, ?, ?)
      `
        )
        .run(profileId, authId, userName, avatarUrl);

      await db.exec('COMMIT');

      const user = await this.getUserWithProfile(authId);
      if (!user) {
        throw new Error('Failed to create Google OAuth user');
      }
      return user;
    } catch (error) {
      await db.exec('ROLLBACK');
      throw error;
    }
  }

  // Get user's third-party identities
  async getUserIdentities(authId: string): Promise<Identifies[]> {
    const db = this.getDb();

    const identities = (await db
      .prepare(
        `
      SELECT * FROM _identifies WHERE auth_id = ?
    `
      )
      .all(authId)) as Identifies[];

    return identities;
  }

  // Get user by third-party provider ID
  async getUserByProviderId(provider: string, providerId: string): Promise<UserWithProfile | null> {
    const db = this.getDb();

    const identify = (await db
      .prepare(
        `
      SELECT * FROM _identifies WHERE provider = ? AND provider_id = ?
    `
      )
      .get(provider, providerId)) as Identifies | null;

    if (!identify) {
      return null;
    }

    return this.getUserWithProfile(identify.auth_id);
  }

  // Get user with profile data including third-party identities
  async getUserWithProfileAndIdentities(
    authId: string
  ): Promise<(UserWithProfile & { identities: Identifies[] }) | null> {
    const user = await this.getUserWithProfile(authId);
    if (!user) {
      return null;
    }

    const identities = await this.getUserIdentities(authId);

    return {
      ...user,
      identities,
    };
  }

  // Generate GitHub OAuth authorization URL
  async generateGitHubAuthUrl(state?: string): Promise<string> {
    const config = await this.loadOAuthConfig();

    if (!config.github.clientId) {
      throw new Error('GitHub OAuth Client ID environment variable is not set');
    }
    if (!config.github.clientSecret) {
      throw new Error('GitHub OAuth Client Secret environment variable is not set');
    }
    if (!config.github.redirectUri) {
      throw new Error('GitHub OAuth Redirect URI environment variable is not set');
    }

    const authUrl = new URL('https://github.com/login/oauth/authorize');
    authUrl.searchParams.set('client_id', config.github.clientId);
    authUrl.searchParams.set('redirect_uri', config.github.redirectUri);
    authUrl.searchParams.set('scope', 'user:email'); // Request user's primary email
    if (state) {
      authUrl.searchParams.set('state', state);
    }

    return authUrl.toString();
  }

  // Exchange GitHub code for an access token
  async exchangeGitHubCodeForToken(code: string): Promise<string> {
    const config = await this.loadOAuthConfig();

    if (this.processedCodes.has(code)) {
      const cachedToken = this.tokenCache.get(code);
      if (cachedToken) {
        return cachedToken.access_token;
      }
      throw new Error('Authorization code is currently being processed.');
    }

    try {
      this.processedCodes.add(code);
      const response = await axios.post(
        'https://github.com/login/oauth/access_token',
        {
          client_id: config.github.clientId,
          client_secret: config.github.clientSecret,
          code,
          redirect_uri: config.github.redirectUri,
        },
        {
          headers: {
            Accept: 'application/json',
          },
        }
      );

      const { access_token, error, error_description } = response.data;

      if (error) {
        throw new Error(`GitHub returned an error: ${error} - ${error_description}`);
      }

      if (!access_token) {
        logger.error('GitHub OAuth response did not contain access_token', {
          response: response.data,
        });
        throw new Error('Failed to get access token from GitHub');
      }

      this.tokenCache.set(code, { access_token, id_token: '' }); // id_token is not used for GitHub

      setTimeout(() => {
        this.processedCodes.delete(code);
        this.tokenCache.delete(code);
      }, 60000);

      return access_token;
    } catch (error) {
      this.processedCodes.delete(code);
      throw new Error(`Failed to exchange GitHub code for token: ${error}`);
    }
  }

  // Get user info from GitHub
  async getGitHubUserInfo(accessToken: string): Promise<GitHubUserInfo> {
    const response = await axios.get('https://api.github.com/user', {
      headers: {
        Authorization: `token ${accessToken}`,
      },
    });
    return response.data;
  }

  // Find or create a user from GitHub profile
  async findOrCreateGitHubUser(githubUserInfo: GitHubUserInfo): Promise<UserWithProfile> {
    const userEmail = githubUserInfo.email || `${githubUserInfo.login}@users.noreply.github.com`;
    const userName = githubUserInfo.name || githubUserInfo.login;
    return this.findOrCreateThirdPartyUser(
      'github',
      githubUserInfo.id.toString(),
      userEmail,
      userName,
      githubUserInfo.avatar_url,
      githubUserInfo
    );
  }
}
