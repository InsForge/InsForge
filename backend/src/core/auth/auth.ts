import jwt from 'jsonwebtoken';
import bcrypt from 'bcryptjs';
import crypto from 'crypto';
import axios from 'axios';
import { OAuth2Client } from 'google-auth-library';
import { DatabaseManager } from '@/core/database/database.js';
import logger from '@/utils/logger.js';
import type {
  UserSchema,
  CreateUserResponse,
  CreateSessionResponse,
  CreateAdminSessionResponse,
  TokenPayloadSchema,
} from '@insforge/shared-schemas';

const JWT_SECRET = process.env.JWT_SECRET;
const JWT_EXPIRES_IN = '7d';

/**
 * Simplified JWT-based auth service
 * Handles all authentication operations including OAuth
 */
export class AuthService {
  private static instance: AuthService;
  private adminEmail: string;
  private adminPassword: string;
  private db: any;
  private processedCodes: Set<string>;
  private tokenCache: Map<string, { access_token: string; id_token: string }>;

  private constructor() {
    if (!JWT_SECRET) {
      throw new Error('JWT_SECRET environment variable is required');
    }
    
    this.adminEmail = process.env.ADMIN_EMAIL!;
    this.adminPassword = process.env.ADMIN_PASSWORD!;
    
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
   * Load OAuth configuration from database - NO CACHING, always fresh
   */
  private async loadOAuthConfig(): Promise<{
    google: { clientId: string; clientSecret: string; redirectUri: string; enabled: boolean };
    github: { clientId: string; clientSecret: string; redirectUri: string; enabled: boolean };
  }> {
    let configRows: any[];
    try {
      const rows = await this.db.prepare(
        `SELECT key, value FROM _config WHERE key LIKE 'auth.oauth.provider.%'`
      ).all();
      configRows = rows || [];
    } catch (error) {
      logger.error('Failed to load OAuth config from database:', error);
      configRows = [];
    }

    const config = {
      google: {
        clientId: '',
        clientSecret: '',
        redirectUri: process.env.GOOGLE_REDIRECT_URI || 'http://localhost:7130/api/auth/oauth/google/callback',
        enabled: false,
      },
      github: {
        clientId: '',
        clientSecret: '',
        redirectUri: process.env.GITHUB_REDIRECT_URI || 'http://localhost:7130/api/auth/oauth/github/callback',
        enabled: false,
      },
    };

    // Load from database values
    for (const row of configRows) {
      try {
        const provider = row.key === 'auth.oauth.provider.google' ? 'google' :
                        row.key === 'auth.oauth.provider.github' ? 'github' : null;

        if (provider && config[provider]) {
          const value = JSON.parse(row.value);
          config[provider].clientId = value.clientId || '';
          config[provider].clientSecret = value.clientSecret || '';
          config[provider].redirectUri = value.redirectUri || config[provider].redirectUri;
          config[provider].enabled = value.enabled || false;
        }
      } catch (e) {
        logger.error('Failed to parse OAuth config', { key: row.key, error: e });
      }
    }

    logger.debug('OAuth config loaded from database', {
      google: { enabled: config.google.enabled, hasClientId: !!config.google.clientId },
      github: { enabled: config.github.enabled, hasClientId: !!config.github.clientId }
    });

    return config;
  }

  /**
   * Transform database user to API format (snake_case to camelCase)
   */
  private dbUserToApiUser(dbUser: any): UserSchema {
    return {
      id: dbUser.id,
      email: dbUser.email,
      name: dbUser.name,
      emailVerified: dbUser.email_verified,
      createdAt: dbUser.created_at,
      updatedAt: dbUser.updated_at
    };
  }

  /**
   * Transform multiple database users to API format
   * Public method for use in auth routes
   */
  public transformUsers(dbUsers: any[]): UserSchema[] {
    return dbUsers.map(user => this.dbUserToApiUser(user));
  }

  /**
   * Transform single database user to API format
   * Public method for use in auth routes
   */
  public transformUser(dbUser: any): UserSchema {
    return this.dbUserToApiUser(dbUser);
  }

  /**
   * Generate JWT token for users and admins
   */
  generateToken(payload: TokenPayloadSchema): string {
    return jwt.sign(payload, JWT_SECRET!, {
      algorithm: 'HS256',
      expiresIn: JWT_EXPIRES_IN,
    });
  }

  /**
   * Verify JWT token
   */
  verifyToken(token: string): TokenPayloadSchema {
    try {
      const decoded = jwt.verify(token, JWT_SECRET!) as TokenPayloadSchema;
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
    const existingUser = await this.db.prepare('SELECT id FROM _user WHERE email = ?').get(email);
    
    if (existingUser) {
      throw new Error('User already exists');
    }

    const hashedPassword = await bcrypt.hash(password, 10);
    const userId = crypto.randomUUID();
    
    await this.db.prepare(`
      INSERT INTO _user (id, email, password, name, email_verified, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, NOW(), NOW())
    `).run(userId, email, hashedPassword, name || null, false);
    
    const dbUser = await this.db.prepare('SELECT id, email, name, email_verified, created_at, updated_at FROM _user WHERE id = ?').get(userId);
    const user = this.dbUserToApiUser(dbUser);
    const accessToken = this.generateToken({ sub: userId, email, role: 'authenticated' });
    
    return { user, accessToken };
  }

  /**
   * User login
   */
  async login(email: string, password: string): Promise<CreateSessionResponse> {
    const dbUser = await this.db.prepare('SELECT * FROM _user WHERE email = ?').get(email);
    
    if (!dbUser || !dbUser.password) {
      throw new Error('Invalid credentials');
    }

    const validPassword = await bcrypt.compare(password, dbUser.password);
    if (!validPassword) {
      throw new Error('Invalid credentials');
    }

    const user = this.dbUserToApiUser(dbUser);
    const accessToken = this.generateToken({ sub: dbUser.id, email: dbUser.email, role: 'authenticated' });
    
    return { user, accessToken };
  }

  /**
   * Admin login (validates against env variables only)
   */
  async adminLogin(email: string, password: string): Promise<CreateAdminSessionResponse> {
    // Simply validate against environment variables
    if (email !== this.adminEmail || password !== this.adminPassword) {
      throw new Error('Invalid admin credentials');
    }

    // Use a fixed admin ID for the system administrator
    const adminId = '00000000-0000-0000-0000-000000000001';
    
    // Return admin user with JWT token - no database interaction
    const accessToken = this.generateToken({ sub: adminId, email, role: 'project_admin' });
    
    return {
      user: {
        id: adminId,
        email: email,
        name: 'Administrator',
        emailVerified: true,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString()
      },
      accessToken
    };
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
    identityData: any
  ): Promise<CreateSessionResponse> {
    // First, try to find existing user by provider ID in _account table
    const account = await this.db.prepare(
      'SELECT * FROM _account WHERE provider = ? AND provider_account_id = ?'
    ).get(provider, providerId);
    
    if (account) {
      // Found existing OAuth user, update last login time
      await this.db.prepare(
        'UPDATE _account SET updated_at = CURRENT_TIMESTAMP WHERE provider = ? AND provider_account_id = ?'
      ).run(provider, providerId);
      
      const dbUser = await this.db.prepare(
        'SELECT id, email, name, email_verified, created_at, updated_at FROM _user WHERE id = ?'
      ).get(account.user_id);
      
      const user = this.dbUserToApiUser(dbUser);
      const accessToken = this.generateToken({ 
        sub: user.id, 
        email: user.email, 
        role: 'authenticated' 
      });
      
      return { user, accessToken };
    }
    
    // If not found by provider_id, try to find by email in _user table
    const existingUser = await this.db.prepare(
      'SELECT * FROM _user WHERE email = ?'
    ).get(email);
    
    if (existingUser) {
      // Found existing user by email, create _account record to link OAuth
      await this.db.prepare(`
        INSERT INTO _account (
          user_id, provider, provider_account_id, 
          provider_data, created_at, updated_at
        )
        VALUES (?, ?, ?, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
      `).run(existingUser.id, provider, providerId, JSON.stringify(identityData));
      
      const user = this.dbUserToApiUser(existingUser);
      const accessToken = this.generateToken({ 
        sub: existingUser.id, 
        email: existingUser.email, 
        role: 'authenticated' 
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
    identityData: any,
    avatarUrl: string
  ): Promise<CreateSessionResponse> {
    const userId = crypto.randomUUID();
    
    await this.db.exec('BEGIN');
    
    try {
      // Create user record (without password for OAuth users)
      await this.db.prepare(`
        INSERT INTO _user (id, email, name, email_verified, created_at, updated_at)
        VALUES (?, ?, ?, true, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
      `).run(userId, email, userName);
      
      // Create _account record
      await this.db.prepare(`
        INSERT INTO _account (
          user_id, provider, provider_account_id,
          provider_data, created_at, updated_at
        )
        VALUES (?, ?, ?, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
      `).run(userId, provider, providerId, JSON.stringify({ ...identityData, avatar_url: avatarUrl }));
      
      await this.db.exec('COMMIT');
      
      const user: UserSchema = {
        id: userId,
        email,
        name: userName,
        emailVerified: true,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString()
      };
      
      const accessToken = this.generateToken({ 
        sub: userId, 
        email, 
        role: 'authenticated' 
      });
      
      return { user, accessToken };
    } catch (error) {
      await this.db.exec('ROLLBACK');
      throw error;
    }
  }

  /**
   * Generate Google OAuth authorization URL - ALWAYS reads fresh from DB
   */
  async generateGoogleAuthUrl(state?: string): Promise<string> {
    const config = await this.loadOAuthConfig(); // Always fresh from DB
    
    if (!config.google.clientId || !config.google.clientSecret) {
      throw new Error('Google OAuth not configured');
    }
    
    logger.debug('Google OAuth Config (fresh from DB):', {
      clientId: config.google.clientId ? 'SET' : 'NOT SET',
      enabled: config.google.enabled,
    });
    
    const authUrl = new URL('https://accounts.google.com/o/oauth2/v2/auth');
    authUrl.searchParams.set('client_id', config.google.clientId);
    authUrl.searchParams.set('redirect_uri', config.google.redirectUri);
    authUrl.searchParams.set('response_type', 'code');
    authUrl.searchParams.set('scope', 'openid email profile');
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
    const config = await this.loadOAuthConfig(); // Always fresh from DB
    
    if (!config.github.clientId || !config.github.clientSecret) {
      throw new Error('GitHub OAuth not configured');
    }
    
    const authUrl = new URL('https://github.com/login/oauth/authorize');
    authUrl.searchParams.set('client_id', config.github.clientId);
    authUrl.searchParams.set('redirect_uri', config.github.redirectUri);
    authUrl.searchParams.set('scope', 'user:email');
    if (state) {
      authUrl.searchParams.set('state', state);
    }
    
    return authUrl.toString();
  }

  /**
   * Exchange Google code for tokens
   */
  async exchangeCodeToTokenByGoogle(code: string): Promise<{ access_token: string; id_token: string }> {
    // Check cache first
    if (this.processedCodes.has(code)) {
      const cachedTokens = this.tokenCache.get(code);
      if (cachedTokens) {
        logger.debug('Returning cached tokens for already processed code.');
        return cachedTokens;
      }
      throw new Error('Authorization code is currently being processed.');
    }
    
    const config = await this.loadOAuthConfig(); // Always fresh from DB
    
    if (!config.google.clientId || !config.google.clientSecret) {
      throw new Error('Google OAuth not configured');
    }
    
    try {
      this.processedCodes.add(code);
      
      logger.info('Exchanging Google code for tokens', {
        hasCode: !!code,
        redirectUri: config.google.redirectUri,
        clientId: config.google.clientId?.substring(0, 10) + '...'
      });
      
      const response = await axios.post('https://oauth2.googleapis.com/token', {
        code,
        client_id: config.google.clientId,
        client_secret: config.google.clientSecret,
        redirect_uri: config.google.redirectUri,
        grant_type: 'authorization_code'
      });
      
      if (!response.data.access_token || !response.data.id_token) {
        throw new Error('Failed to get tokens from Google');
      }
      
      const result = {
        access_token: response.data.access_token,
        id_token: response.data.id_token
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
          redirectUri: config.google.redirectUri
        });
        throw new Error(`Google OAuth error: ${JSON.stringify(error.response.data)}`);
      }
      throw error;
    }
  }

  /**
   * Verify Google ID token and get user info
   */
  async verifyGoogleToken(idToken: string): Promise<any> {
    const config = await this.loadOAuthConfig(); // Always fresh from DB
    
    if (!config.google.clientId || !config.google.clientSecret) {
      throw new Error('Google OAuth not configured');
    }

    // Create OAuth2Client with fresh config
    const googleClient = new OAuth2Client(
      config.google.clientId,
      config.google.clientSecret,
      config.google.redirectUri
    );

    try {
      // Properly verify the ID token with Google's servers
      const ticket = await googleClient.verifyIdToken({
        idToken,
        audience: config.google.clientId,
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
  async findOrCreateGoogleUser(googleUserInfo: any): Promise<CreateSessionResponse> {
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
    const config = await this.loadOAuthConfig(); // Always fresh from DB
    
    if (!config.github.clientId || !config.github.clientSecret) {
      throw new Error('GitHub OAuth not configured');
    }
    
    const response = await axios.post(
      'https://github.com/login/oauth/access_token',
      {
        client_id: config.github.clientId,
        client_secret: config.github.clientSecret,
        code,
        redirect_uri: config.github.redirectUri
      },
      {
        headers: {
          Accept: 'application/json'
        }
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
  async getGitHubUserInfo(accessToken: string): Promise<any> {
    const userResponse = await axios.get('https://api.github.com/user', {
      headers: {
        Authorization: `Bearer ${accessToken}`
      }
    });
    
    // GitHub doesn't always return email in user endpoint
    let email = userResponse.data.email;
    
    if (!email) {
      const emailResponse = await axios.get('https://api.github.com/user/emails', {
        headers: {
          Authorization: `Bearer ${accessToken}`
        }
      });
      
      const primaryEmail = emailResponse.data.find((e: any) => e.primary);
      email = primaryEmail ? primaryEmail.email : emailResponse.data[0]?.email;
    }
    
    return {
      id: userResponse.data.id,
      login: userResponse.data.login,
      name: userResponse.data.name,
      email: email || `${userResponse.data.login}@users.noreply.github.com`,
      avatar_url: userResponse.data.avatar_url
    };
  }

  /**
   * Find or create GitHub user
   */
  async findOrCreateGitHubUser(githubUserInfo: any): Promise<CreateSessionResponse> {
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
   * Generate a new API key
   */
  generateApiKey(): string {
    return crypto.randomBytes(32).toString('hex');
  }

  /**
   * Verify API key against database
   */
  async verifyApiKey(apiKey: string): Promise<boolean> {
    if (!apiKey) {
      return false;
    }
    const dbManager = DatabaseManager.getInstance();
    const storedApiKey = await dbManager.getApiKey();
    return storedApiKey === apiKey;
  }

  /**
   * Initialize API key on startup
   * Seeds from environment variable if database is empty
   */
  async initializeApiKey(): Promise<string> {
    const dbManager = DatabaseManager.getInstance();
    let apiKey = await dbManager.getApiKey();

    if (!apiKey) {
      // Check if ACCESS_API_KEY is provided via environment
      const envApiKey = process.env.ACCESS_API_KEY;
      
      if (envApiKey && envApiKey.trim() !== '') {
        // Use the provided API key from environment
        apiKey = envApiKey;
        await dbManager.setApiKey(apiKey);
        logger.info('✅ API key initialized from ACCESS_API_KEY environment variable');
      } else {
        // Generate a new API key if none provided
        apiKey = this.generateApiKey();
        await dbManager.setApiKey(apiKey);
        logger.info('✅ API key generated and stored');
      }
    } else {
      logger.info('✅ API key exists in database');
    }

    return apiKey;
  }

  /**
   * Get database instance for direct queries
   */
  getDb() {
    return this.db;
  }
}