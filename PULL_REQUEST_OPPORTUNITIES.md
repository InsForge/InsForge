# High-Impact Pull Request Opportunities for InsForge

## Executive Summary
This document identifies 8 high-impact, production-ready pull request opportunities that demonstrate professional software engineering knowledge. These issues affect critical functionality (real-time systems, authentication, database operations) and would significantly improve code quality and reliability.

---

## 🔴 HIGH IMPACT ISSUES

### 1. **Silent Error Handling in Database Transactions (CRITICAL)**

**Issue Title:** Fix Silent Error Swallowing in Transaction Rollbacks

**Description:**
Multiple critical services use `.catch(() => {})` to silently catch errors during transaction rollbacks. This anti-pattern masks database failures and makes debugging extremely difficult.

**Current Code Problem:**
```typescript
// File: backend/src/services/realtime/realtime-message.service.ts (Line 96)
try {
  // ... do database work
  return { /* success */ };
} catch (error) {
  // Rollback transaction on error
  await client.query('ROLLBACK').catch(() => {});  // ❌ SILENT ERROR!
  
  logger.debug('Message insert denied or failed', { channelName, eventName, userId, error });
  return null;
}

// File: backend/src/services/deployments/deployment.service.ts (Line 313)
}).catch(() => {});  // ❌ Another silent catch
```

**Business Impact:**
- Database transaction failures go unnoticed
- Production bugs become silent data corruption
- Impossible to monitor system health
- RLS policy violations not logged properly

**Proposed Solution:**
```typescript
// IMPROVED: Proper error handling with logging
try {
  // ... do database work
  return { /* success */ };
} catch (error) {
  // Attempt rollback with error handling
  try {
    await client.query('ROLLBACK');
  } catch (rollbackError) {
    logger.error('Critical: Failed to rollback transaction', {
      originalError: error instanceof Error ? error.message : String(error),
      rollbackError: rollbackError instanceof Error ? rollbackError.message : String(rollbackError),
      channelName,
      userId,
    });
    // Re-throw to ensure connection is properly released
    throw rollbackError;
  }
  
  logger.debug('Message insert denied or failed', { 
    channelName, 
    eventName, 
    userId, 
    error: error instanceof Error ? error.message : String(error) 
  });
  return null;
} finally {
  // Reset role back to default before releasing connection
  try {
    await client.query('RESET ROLE');
  } catch (resetError) {
    logger.error('Failed to reset role after transaction', {
      error: resetError instanceof Error ? resetError.message : String(resetError),
    });
  }
  client.release();
}
```

**Affected Files:**
- `backend/src/services/realtime/realtime-message.service.ts`
- `backend/src/services/realtime/realtime-auth.service.ts`
- `backend/src/services/deployments/deployment.service.ts`
- `backend/src/providers/functions/deno-subhosting.provider.ts`

**Difficulty Level:** MEDIUM
**Estimated Time:** 2-3 hours
**Testing:** 3-4 hours (need to write tests for failure scenarios)

**Impact Assessment:**
- ✅ Prevents silent data corruption
- ✅ Improves debugging and monitoring
- ✅ Increases system reliability
- ✅ Provides audit trails for RLS violations
- ⚠️ No breaking changes

---

### 2. **Missing Graceful Shutdown for Background Intervals (HIGH)**

**Issue Title:** Implement Proper Cleanup for Background Intervals on Server Shutdown

**Description:**
Multiple services use `setInterval()` but don't properly clean up these intervals during server shutdown. This can cause memory leaks and hanging processes.

**Current Code Problem:**
```typescript
// File: backend/src/services/auth/oauth-pkce.service.ts
export class OAuthPKCEService {
  private static instance: OAuthPKCEService;
  private cleanupInterval: ReturnType<typeof setInterval> | null = null;

  private constructor() {
    // Cleanup interval reference (for graceful shutdown)
    this.cleanupInterval = setInterval(() => this.cleanupExpiredCodes(), this.CLEANUP_INTERVAL_MS);
  }

  // ❌ NO CLEANUP METHOD EXISTS!
  // cleanupExpired codes runs every 60 seconds but is never stopped
}

// File: backend/src/server.ts - Server shutdown
process.on('SIGTERM', async () => {
  logger.info('Shutting down gracefully...');
  // ❌ MISSING: OAuth PKCE cleanup not called
  // ❌ MISSING: Function service cleanup not called
  // ❌ MISSING: Other service cleanups not called
});
```

**Business Impact:**
- Server hangs on deployments
- Memory leaks in production
- Infrastructure becomes unreliable
- Container orchestration times out during shutdown

**Proposed Solution:**
```typescript
// File: backend/src/services/auth/oauth-pkce.service.ts
export class OAuthPKCEService {
  private static instance: OAuthPKCEService;
  private cleanupInterval: ReturnType<typeof setInterval> | null = null;
  private readonly CLEANUP_INTERVAL_MS = 60 * 1000; // 60 seconds

  private constructor() {
    this.cleanupInterval = setInterval(() => this.cleanupExpiredCodes(), this.CLEANUP_INTERVAL_MS);
  }

  /**
   * Clean up resources for graceful shutdown
   */
  async cleanup(): Promise<void> {
    if (this.cleanupInterval) {
      clearInterval(this.cleanupInterval);
      this.cleanupInterval = null;
      logger.debug('Cleared OAuth PKCE cleanup interval');
    }
  }

  // ... rest of class
}

// File: backend/src/server.ts - Add shutdown handler
async function gracefulShutdown(signal: string): Promise<void> {
  logger.info(`Received ${signal}, shutting down gracefully...`);
  
  try {
    // Clean up services in reverse initialization order
    await OAuthPKCEService.getInstance().cleanup();
    await FunctionService.getInstance().cleanup();
    await SocketManager.getInstance().close();
    
    // Close database connections
    const dbManager = DatabaseManager.getInstance();
    await dbManager.close();
    
    logger.info('Graceful shutdown completed');
    process.exit(0);
  } catch (error) {
    logger.error('Error during graceful shutdown:', error);
    process.exit(1);
  }
}

process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
process.on('SIGINT', () => gracefulShutdown('SIGINT'));
```

**Affected Services:**
- `OAuthPKCEService` - OAuth PKCE cleanup interval
- `FunctionService` - Deployment timer
- `RealtimeManager` - Message listeners
- `SocketManager` - Socket connections

**Difficulty Level:** MEDIUM
**Estimated Time:** 3-4 hours
**Testing:** 2-3 hours (integration tests for shutdown)

**Impact Assessment:**
- ✅ Eliminates memory leaks
- ✅ Enables fast, reliable deployments
- ✅ Prevents hanging processes
- ✅ Improves Kubernetes pod eviction experience
- ⚠️ Requires update to all service classes

---

### 3. **Environment Variable Configuration for S3 (MEDIUM)**

**Issue Title:** Make S3 Configuration Fully Configurable via Environment Variables

**Description:**
Hardcoded S3 bucket names limit cloud deployments and multi-tenant support. The TODO comment explicitly marks this as incomplete.

**Current Code Problem:**
```typescript
// File: backend/src/utils/s3-config-loader.ts (Line 4)
// TODO: make these configurable in env variables in cloud backend
const CONFIG_BUCKET = process.env.AWS_CONFIG_BUCKET || 'insforge-config';
const CONFIG_REGION = process.env.AWS_CONFIG_REGION || 'us-east-2';

// BUT: These defaults are HARDCODED and not validated!
```

**Business Impact:**
- Cannot deploy to different AWS regions per customer
- Cannot use customer-provided buckets
- Cloud-hosted deployments inflexible
- No migration path for multi-region setup

**Proposed Solution:**
```typescript
// File: backend/src/utils/s3-config-loader.ts

import { z } from 'zod';
import logger from '@/utils/logger.js';

// Environment validation schema
const S3ConfigSchema = z.object({
  AWS_CONFIG_BUCKET: z.string().min(3).max(63),
  AWS_CONFIG_REGION: z.string().min(1),
  AWS_S3_CONFIG_TIMEOUT: z.string().regex(/^\d+$/).transform(Number).optional(),
});

type S3ConfigType = z.infer<typeof S3ConfigSchema>;

function getS3Config(): S3ConfigType {
  const config = {
    AWS_CONFIG_BUCKET: process.env.AWS_CONFIG_BUCKET,
    AWS_CONFIG_REGION: process.env.AWS_CONFIG_REGION,
    AWS_S3_CONFIG_TIMEOUT: process.env.AWS_S3_CONFIG_TIMEOUT,
  };

  try {
    return S3ConfigSchema.parse(config);
  } catch (error) {
    logger.error('Invalid S3 configuration:', {
      error: error instanceof z.ZodError ? error.errors : String(error),
      hint: 'Ensure AWS_CONFIG_BUCKET and AWS_CONFIG_REGION are set in environment variables',
    });
    throw new Error('S3 configuration is invalid - check environment variables');
  }
}

const s3Config = getS3Config();

export const CONFIG_BUCKET = s3Config.AWS_CONFIG_BUCKET;
export const CONFIG_REGION = s3Config.AWS_CONFIG_REGION;
export const CONFIG_TIMEOUT = s3Config.AWS_S3_CONFIG_TIMEOUT ?? 10000;

let s3Client: S3Client | null = null;

function getS3Client(): S3Client {
  if (s3Client) {
    return s3Client;
  }

  const clientConfig: {
    region: string;
    credentials?: { accessKeyId: string; secretAccessKey: string };
  } = {
    region: CONFIG_REGION,
  };

  if (process.env.AWS_ACCESS_KEY_ID && process.env.AWS_SECRET_ACCESS_KEY) {
    clientConfig.credentials = {
      accessKeyId: process.env.AWS_ACCESS_KEY_ID,
      secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
    };
  }

  s3Client = new S3Client(clientConfig);
  return s3Client;
}

export async function fetchS3Config<T>(key: string): Promise<T | null> {
  try {
    const command = new GetObjectCommand({
      Bucket: CONFIG_BUCKET,
      Key: key,
    });

    const response = await getS3Client().send(command);
    const body = await response.Body?.transformToString();
    
    if (!body) {
      logger.warn('Empty S3 config response', { bucket: CONFIG_BUCKET, key });
      return null;
    }

    try {
      return JSON.parse(body) as T;
    } catch (parseError) {
      logger.error('Failed to parse S3 config JSON', {
        bucket: CONFIG_BUCKET,
        key,
        error: parseError instanceof Error ? parseError.message : String(parseError),
      });
      return null;
    }
  } catch (error) {
    logger.error('Failed to fetch S3 config', {
      bucket: CONFIG_BUCKET,
      key,
      region: CONFIG_REGION,
      error: error instanceof Error ? error.message : String(error),
    });
    return null;
  }
}
```

**Environment Variables Document:**
```bash
# .env.example additions
AWS_CONFIG_BUCKET=insforge-config
AWS_CONFIG_REGION=us-east-2
AWS_S3_CONFIG_TIMEOUT=10000
```

**Affected Files:**
- `backend/src/utils/s3-config-loader.ts`
- `.env.example`
- Documentation update needed

**Difficulty Level:** EASY
**Estimated Time:** 1-2 hours
**Testing:** 1 hour

**Impact Assessment:**
- ✅ Enables multi-region deployments
- ✅ Supports customer-provided infrastructure
- ✅ Validates configuration at startup
- ✅ Improves operational flexibility
- ⚠️ Requires environment variable updates

---

### 4. **Unhandled Error Cases in Storage Service (MEDIUM)**

**Issue Title:** Fix Missing Error Handling in Storage Route Handlers

**Description:**
Several storage endpoints have empty `.catch()` blocks where errors are silently ignored, preventing clients from receiving proper error responses.

**Current Code Problem:**
```typescript
// File: backend/src/api/routes/storage/index.routes.ts (Line 20-28)
router.get(
  '/:bucketName/*',
  async (req: AuthRequest, res: Response, next: NextFunction) => {
    try {
      const storageService = StorageService.getInstance();
      const isPublic = await storageService.isBucketPublic(req.params.bucketName);

      if (isPublic) {
        return next();
      }
    } catch {
      // If error checking bucket, continue with auth requirement
      // ❌ PROBLEM: Client never gets informed about the bucket check failure!
    }

    return verifyUser(req, res, next);
  }
);
```

**Business Impact:**
- Failed bucket lookups silently proceed to auth check
- Clients cannot distinguish between permission denied vs. bucket error
- Storage debugging becomes impossible
- Audit trails incomplete

**Proposed Solution:**
```typescript
// File: backend/src/api/routes/storage/index.routes.ts

router.get(
  '/:bucketName/*',
  async (req: AuthRequest, res: Response, next: NextFunction) => {
    try {
      const storageService = StorageService.getInstance();
      
      try {
        const isPublic = await storageService.isBucketPublic(req.params.bucketName);
        if (isPublic) {
          return next();
        }
      } catch (bucketCheckError) {
        // Only ignore "bucket not found" errors - proceed to auth check
        if (bucketCheckError instanceof AppError && 
            (bucketCheckError.code === ERROR_CODES.NOT_FOUND || 
             bucketCheckError.statusCode === 404)) {
          // Bucket doesn't exist or is not accessible - require auth
          logger.debug('Bucket not found or not accessible, requiring auth', {
            bucket: req.params.bucketName,
          });
          return verifyUser(req, res, next);
        }
        
        // For any other error, propagate to error handler
        logger.error('Unexpected error checking bucket public status', {
          bucket: req.params.bucketName,
          error: bucketCheckError instanceof Error ? bucketCheckError.message : String(bucketCheckError),
        });
        return next(bucketCheckError);
      }
    } catch (error) {
      return next(error);
    }

    return verifyUser(req, res, next);
  }
);

// Apply same pattern to other problematic routes:
// POST /api/storage/buckets (line 39-51)
// GET /api/storage/buckets/:bucketName (line 54-103)
// DELETE /api/storage/buckets/:bucketName (line 127-177)
// etc.
```

**Affected Routes in storage/index.routes.ts:**
- Line 20: GET public bucket download
- Line 39: POST /buckets upload
- Line 54: GET bucket info
- Line 127: GET bucket metadata
- Line 192: PUT bucket update
- Multiple others

**Difficulty Level:** EASY
**Estimated Time:** 2 hours
**Testing:** 1-2 hours

**Impact Assessment:**
- ✅ Improves error feedback to clients
- ✅ Enables proper debugging
- ✅ Increases API reliability
- ✅ Completes error handling implementation
- ⚠️ May require client updates to handle new error responses

---

### 5. **Missing Error Context in Auth Service (MEDIUM)**

**Issue Title:** Improve Error Messages with Context Information

**Description:**
Many error messages lack sufficient context, making debugging difficult for both developers and end-users. Error messages should include relevant identifiers and operation context.

**Current Code Problem:**
```typescript
// File: backend/src/services/auth/auth.service.ts (Line 339)
async verifyEmail(verificationToken: string): Promise<UserSchema> {
  try {
    // ... token verification logic
  } catch {
    throw new Error('User not found');  // ❌ VAGUE: Which user? Why not found?
  }
}

// File: Line 405
async resetPassword(token: string, password: string): Promise<UserSchema> {
  try {
    // ... password reset logic
  } catch {
    throw new Error('User not found');  // ❌ Generic message
  }
}

// File: Line 890
async initializeOAuthFlow(provider: string): Promise<string> {
  if (!OAUTH_PROVIDERS.includes(provider)) {
    throw new Error(`OAuth provider ${provider} is not implemented yet.`);
    // ❌ Should suggest available providers
  }
}
```

**Business Impact:**
- Operators cannot diagnose auth issues
- User confusion on failed operations
- Support tickets difficult to troubleshoot
- Security audit trails incomplete

**Proposed Solution:**
```typescript
// File: backend/src/services/auth/auth.service.ts

async verifyEmail(verificationToken: string): Promise<UserSchema> {
  try {
    // ... verify token and extract userId
    const user = await this.getUserById(userId);
    
    if (!user) {
      throw new AppError(
        'User account no longer exists',
        404,
        ERROR_CODES.NOT_FOUND,
        NEXT_ACTION.CONTACT_SUPPORT
      );
    }
    
    return user;
  } catch (error) {
    if (error instanceof AppError) {
      throw error;
    }
    
    // Provide context about what failed
    logger.error('Email verification failed', {
      tokenLength: verificationToken.length,
      error: error instanceof Error ? error.message : String(error),
    });
    
    throw new AppError(
      'Email verification failed. Please try requesting a new verification email.',
      400,
      ERROR_CODES.AUTH_FAILED,
      NEXT_ACTION.RESEND_VERIFICATION_EMAIL
    );
  }
}

async resetPassword(token: string, password: string): Promise<UserSchema> {
  try {
    const { userId } = this.tokenManager.verifyPasswordResetToken(token);
    
    // Validate password requirements
    const passwordValidation = validatePassword(password);
    if (!passwordValidation.isValid) {
      throw new AppError(
        passwordValidation.message || 'Password does not meet requirements',
        400,
        ERROR_CODES.INVALID_INPUT,
        NEXT_ACTION.FOLLOW_PASSWORD_REQUIREMENTS
      );
    }
    
    const user = await this.getUserById(userId);
    if (!user) {
      // User was deleted - provide clear message
      throw new AppError(
        'User account does not exist',
        404,
        ERROR_CODES.NOT_FOUND,
        NEXT_ACTION.CREATE_NEW_ACCOUNT
      );
    }
    
    // Reset password logic...
    return updatedUser;
  } catch (error) {
    // ... error handling
  }
}

/**
 * Initialize OAuth flow with provider validation
 */
async initializeOAuthFlow(provider: string): Promise<string> {
  const validProviders = Object.keys(OAUTH_PROVIDERS);
  
  if (!validProviders.includes(provider)) {
    throw new AppError(
      `OAuth provider "${provider}" is not supported`,
      400,
      ERROR_CODES.INVALID_INPUT,
      `Supported providers: ${validProviders.join(', ')}`
    );
  }
  
  try {
    const oauthProvider = OAUTH_PROVIDERS[provider];
    return await oauthProvider.initializeFlow();
  } catch (error) {
    logger.error('OAuth flow initialization failed', {
      provider,
      error: error instanceof Error ? error.message : String(error),
    });
    
    throw new AppError(
      `Failed to initialize ${provider} OAuth flow`,
      500,
      ERROR_CODES.INTERNAL_ERROR,
      NEXT_ACTION.CONTACT_SUPPORT
    );
  }
}
```

**Add to error-constants.ts:**
```typescript
export const NEXT_ACTION = {
  CONTACT_SUPPORT: 'Please contact support if this issue persists',
  RESEND_VERIFICATION_EMAIL: 'Request a new verification email',
  CREATE_NEW_ACCOUNT: 'Create a new account and try again',
  FOLLOW_PASSWORD_REQUIREMENTS: 'Ensure password meets all requirements',
} as const;
```

**Affected Files:**
- `backend/src/services/auth/auth.service.ts`
- `backend/src/types/error-constants.ts`

**Difficulty Level:** MEDIUM
**Estimated Time:** 3-4 hours
**Testing:** 2 hours

**Impact Assessment:**
- ✅ Improves debugging and troubleshooting
- ✅ Better error messages for end users
- ✅ Clearer API responses
- ✅ Easier support ticket resolution
- ⚠️ May require client UI updates

---

### 6. **Database Connection Pool Optimization (HIGH)**

**Issue Title:** Add Connection Pool Health Checks and Configurable Pool Size

**Description:**
The database connection pool configuration is limited and lacks health monitoring. No mechanism exists to detect and recover from stale connections.

**Current Code Problem:**
```typescript
// File: backend/src/infra/database/database.manager.ts (Line 27-35)
async initialize(): Promise<void> {
  await fs.mkdir(this.dataDir, { recursive: true });

  this.pool = new Pool({
    host: process.env.POSTGRES_HOST || 'localhost',
    port: parseInt(process.env.POSTGRES_PORT || '5432'),
    database: process.env.POSTGRES_DB || 'insforge',
    user: process.env.POSTGRES_USER || 'postgres',
    password: process.env.POSTGRES_PASSWORD || 'postgres',
    max: 20,  // ❌ HARDCODED - cannot adjust for load
    idleTimeoutMillis: 30000,  // ❌ No validation
    connectionTimeoutMillis: 2000,  // ❌ Very tight timeout
  });
  
  // ❌ NO ERROR HANDLING ON POOL INITIALIZATION
  // ❌ NO HEALTH CHECK MECHANISM
  // ❌ NO IDLE CONNECTION CLEANUP
}
```

**Business Impact:**
- Under-provisioned for high load
- Stale connections cause mysterious failures
- No visibility into connection pool health
- Production outages from connection exhaustion

**Proposed Solution:**
```typescript
// File: backend/src/infra/database/database.manager.ts

import { Pool, PoolClient } from 'pg';
import { z } from 'zod';
import logger from '@/utils/logger.js';

// Pool configuration schema with validation
const PoolConfigSchema = z.object({
  max: z.number().min(5).max(100).default(20),
  idleTimeoutMillis: z.number().min(10000).max(600000).default(30000),
  connectionTimeoutMillis: z.number().min(1000).max(30000).default(5000),
  statementTimeoutMillis: z.number().min(5000).max(600000).default(30000),
});

type PoolConfig = z.infer<typeof PoolConfigSchema>;

function getPoolConfig(): PoolConfig {
  try {
    return PoolConfigSchema.parse({
      max: process.env.DB_POOL_MAX ? parseInt(process.env.DB_POOL_MAX, 10) : undefined,
      idleTimeoutMillis: process.env.DB_IDLE_TIMEOUT_MS ? parseInt(process.env.DB_IDLE_TIMEOUT_MS, 10) : undefined,
      connectionTimeoutMillis: process.env.DB_CONNECTION_TIMEOUT_MS ? parseInt(process.env.DB_CONNECTION_TIMEOUT_MS, 10) : undefined,
      statementTimeoutMillis: process.env.DB_STATEMENT_TIMEOUT_MS ? parseInt(process.env.DB_STATEMENT_TIMEOUT_MS, 10) : undefined,
    });
  } catch (error) {
    logger.warn('Invalid pool configuration, using defaults', {
      error: error instanceof z.ZodError ? error.errors : String(error),
    });
    return PoolConfigSchema.parse({});
  }
}

export interface PoolHealthStatus {
  healthy: boolean;
  totalConnections: number;
  idleConnections: number;
  activeConnections: number;
  waitingRequests: number;
  lastHealthCheckTime: Date;
}

export class DatabaseManager {
  private static instance: DatabaseManager;
  private pool!: Pool;
  private dataDir: string;
  private healthCheckInterval: ReturnType<typeof setInterval> | null = null;
  private lastHealthStatus: PoolHealthStatus | null = null;

  private constructor() {
    this.dataDir = process.env.DATABASE_DIR || path.join(__dirname, '../../data');
  }

  static getInstance(): DatabaseManager {
    if (!DatabaseManager.instance) {
      DatabaseManager.instance = new DatabaseManager();
    }
    return DatabaseManager.instance;
  }

  async initialize(): Promise<void> {
    await fs.mkdir(this.dataDir, { recursive: true });

    const poolConfig = getPoolConfig();

    this.pool = new Pool({
      host: process.env.POSTGRES_HOST || 'localhost',
      port: parseInt(process.env.POSTGRES_PORT || '5432', 10),
      database: process.env.POSTGRES_DB || 'insforge',
      user: process.env.POSTGRES_USER || 'postgres',
      password: process.env.POSTGRES_PASSWORD || 'postgres',
      max: poolConfig.max,
      idleTimeoutMillis: poolConfig.idleTimeoutMillis,
      connectionTimeoutMillis: poolConfig.connectionTimeoutMillis,
      statement_timeout: poolConfig.statementTimeoutMillis,
    });

    // Test connection
    let testClient: PoolClient | null = null;
    try {
      testClient = await this.pool.connect();
      const result = await testClient.query('SELECT NOW()');
      logger.info('Database connection successful', {
        timestamp: result.rows[0].now,
        poolSize: poolConfig.max,
      });
    } catch (error) {
      logger.error('Failed to connect to database', {
        error: error instanceof Error ? error.message : String(error),
        config: {
          host: process.env.POSTGRES_HOST,
          port: process.env.POSTGRES_PORT,
          database: process.env.POSTGRES_DB,
        },
      });
      throw error;
    } finally {
      if (testClient) {
        testClient.release();
      }
    }

    // Set up error event handlers
    this.pool.on('error', (error) => {
      logger.error('Unexpected database pool error', {
        error: error instanceof Error ? error.message : String(error),
      });
    });

    // Start health check
    this.startHealthCheck();
  }

  /**
   * Start periodic health checks
   */
  private startHealthCheck(): void {
    // Run health check every 30 seconds
    this.healthCheckInterval = setInterval(async () => {
      try {
        await this.performHealthCheck();
      } catch (error) {
        logger.error('Health check failed', {
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }, 30000);
  }

  /**
   * Perform health check on connection pool
   */
  private async performHealthCheck(): Promise<void> {
    let client: PoolClient | null = null;
    try {
      client = await this.pool.connect();
      await client.query('SELECT 1');
      
      // Pool is healthy
      this.lastHealthStatus = {
        healthy: true,
        totalConnections: this.pool.totalCount,
        idleConnections: this.pool.idleCount,
        activeConnections: this.pool.totalCount - this.pool.idleCount,
        waitingRequests: this.pool.waitingCount,
        lastHealthCheckTime: new Date(),
      };

      if (this.pool.waitingCount > 5) {
        logger.warn('High number of waiting connection requests', {
          waitingRequests: this.pool.waitingCount,
          totalConnections: this.pool.totalCount,
          idleConnections: this.pool.idleCount,
        });
      }
    } catch (error) {
      logger.error('Database pool health check failed', {
        error: error instanceof Error ? error.message : String(error),
        poolStatus: {
          total: this.pool.totalCount,
          idle: this.pool.idleCount,
          waiting: this.pool.waitingCount,
        },
      });
      
      this.lastHealthStatus = {
        healthy: false,
        totalConnections: this.pool.totalCount,
        idleConnections: this.pool.idleCount,
        activeConnections: this.pool.totalCount - this.pool.idleCount,
        waitingRequests: this.pool.waitingCount,
        lastHealthCheckTime: new Date(),
      };
    } finally {
      if (client) {
        client.release();
      }
    }
  }

  /**
   * Get current health status
   */
  getHealthStatus(): PoolHealthStatus | null {
    return this.lastHealthStatus;
  }

  /**
   * Get pool instance
   */
  getPool(): Pool {
    return this.pool;
  }

  /**
   * Clean up resources for graceful shutdown
   */
  async close(): Promise<void> {
    if (this.healthCheckInterval) {
      clearInterval(this.healthCheckInterval);
      this.healthCheckInterval = null;
    }

    try {
      await this.pool.end();
      logger.debug('Database pool closed successfully');
    } catch (error) {
      logger.error('Error closing database pool', {
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }
}
```

**Add Health Endpoint:**
```typescript
// File: backend/src/api/routes/health/index.routes.ts
export const healthRouter = Router();

healthRouter.get('/health', (req: Request, res: Response) => {
  const dbManager = DatabaseManager.getInstance();
  const poolHealth = dbManager.getHealthStatus();

  if (!poolHealth) {
    return res.status(503).json({
      status: 'unhealthy',
      message: 'Pool health check not yet performed',
    });
  }

  const status = poolHealth.healthy ? 200 : 503;
  res.status(status).json({
    status: poolHealth.healthy ? 'healthy' : 'unhealthy',
    database: {
      connected: poolHealth.healthy,
      totalConnections: poolHealth.totalConnections,
      activeConnections: poolHealth.activeConnections,
      idleConnections: poolHealth.idleConnections,
      waitingRequests: poolHealth.waitingRequests,
      lastCheck: poolHealth.lastHealthCheckTime,
    },
  });
});
```

**Environment Variables:**
```bash
# .env.example
DB_POOL_MAX=20
DB_IDLE_TIMEOUT_MS=30000
DB_CONNECTION_TIMEOUT_MS=5000
DB_STATEMENT_TIMEOUT_MS=30000
```

**Affected Files:**
- `backend/src/infra/database/database.manager.ts`
- `backend/src/api/routes/health/index.routes.ts` (new)
- `backend/src/server.ts` (integrate health route)

**Difficulty Level:** MEDIUM
**Estimated Time:** 4-5 hours
**Testing:** 3-4 hours (load tests, failure scenarios)

**Impact Assessment:**
- ✅ Prevents connection pool exhaustion
- ✅ Enables load tuning per environment
- ✅ Provides visibility into pool health
- ✅ Improves production reliability
- ✅ Enables better capacity planning

---

### 7. **API Key Token Never Expires (SECURITY) (HIGH)**

**Issue Title:** Remove Non-Expiring API Key Tokens and Implement Proper Key Rotation

**Description:**
The system generates API key tokens with no expiration time. This violates security best practices and creates security risks if keys are compromised.

**Current Code Problem:**
```typescript
// File: backend/src/infra/security/token.manager.ts (Line 69-77)

/**
 * Generate API key token (never expires)
 * Used for internal API key authenticated requests to PostgREST
 */
generateApiKeyToken(): string {
  const payload = {
    sub: 'project-admin-with-api-key',
    email: 'project-admin@email.com',
    role: 'project_admin',
  };
  return jwt.sign(payload, JWT_SECRET, {
    algorithm: 'HS256',
    // No expiresIn means token never expires  ❌ SECURITY RISK!
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
  return jwt.sign(payload, JWT_SECRET, {
    algorithm: 'HS256',
    // No expiresIn means token never expires  ❌ SECURITY RISK!
  });
}
```

**Security Impact:**
- CRITICAL: Compromised keys have infinite lifetime
- Cannot revoke API access without changing JWT_SECRET
- Violates OWASP token management guidelines
- Increases attack surface for lateral movement

**Proposed Solution:**
```typescript
// File: backend/src/infra/security/token.manager.ts

const JWT_SECRET = process.env.JWT_SECRET ?? '';
const ACCESS_TOKEN_EXPIRES_IN = '15m';
const REFRESH_TOKEN_EXPIRES_IN = '7d';
const API_KEY_TOKEN_EXPIRES_IN = '90d';  // NEW: API keys expire after 90 days
const ANON_TOKEN_EXPIRES_IN = '24h';    // NEW: Anon tokens expire after 24 hours

/**
 * Generate API key token with expiration
 * Used for internal API key authenticated requests to PostgREST
 */
generateApiKeyToken(): string {
  const payload = {
    sub: 'project-admin-with-api-key',
    email: 'project-admin@email.com',
    role: 'project_admin',
    type: 'api_key',
  };
  return jwt.sign(payload, JWT_SECRET, {
    algorithm: 'HS256',
    expiresIn: API_KEY_TOKEN_EXPIRES_IN,  // ✅ NEW: Expires after 90 days
  });
}

/**
 * Generate anonymous JWT token with expiration
 */
generateAnonToken(): string {
  const payload = {
    sub: '12345678-1234-5678-90ab-cdef12345678',
    email: 'anon@insforge.com',
    role: 'anon',
    type: 'anon',
  };
  return jwt.sign(payload, JWT_SECRET, {
    algorithm: 'HS256',
    expiresIn: ANON_TOKEN_EXPIRES_IN,  // ✅ NEW: Expires after 24 hours
  });
}

/**
 * Verify token with type checking
 */
verifyToken(token: string, expectedType?: string): TokenPayloadSchema & { type?: string } {
  try {
    const decoded = jwt.verify(token, JWT_SECRET) as TokenPayloadSchema & { type?: string };
    
    if (expectedType && decoded.type !== expectedType) {
      throw new AppError(
        `Invalid token type. Expected: ${expectedType}, got: ${decoded.type}`,
        401,
        ERROR_CODES.AUTH_UNAUTHORIZED
      );
    }
    
    return {
      sub: decoded.sub,
      email: decoded.email,
      role: decoded.role || 'authenticated',
      type: decoded.type,
    };
  } catch (error) {
    if (error instanceof AppError) {
      throw error;
    }
    if (error instanceof jwt.TokenExpiredError) {
      throw new AppError(
        'Token has expired. Please generate a new one.',
        401,
        ERROR_CODES.AUTH_UNAUTHORIZED
      );
    }
    throw new AppError('Invalid token', 401, ERROR_CODES.AUTH_UNAUTHORIZED);
  }
}
```

**Audit & Monitoring:**
```typescript
// File: backend/src/services/secrets/api-key.service.ts (NEW)

export interface APIKeyRecord {
  id: string;
  projectId: string;
  name: string;
  maskedKey: string;  // Last 4 chars only
  createdAt: Date;
  expiresAt: Date;
  lastUsedAt: Date | null;
  revokedAt: Date | null;
}

export class APIKeyService {
  /**
   * Log API key token generation for audit trail
   */
  async logTokenGeneration(projectId: string): Promise<void> {
    // Store in audit log table with expiration date
    await this.auditLog.create({
      projectId,
      action: 'API_KEY_TOKEN_GENERATED',
      expiresAt: new Date(Date.now() + 90 * 24 * 60 * 60 * 1000),
      timestamp: new Date(),
    });
  }

  /**
   * List all active API keys
   */
  async listActiveKeys(projectId: string): Promise<APIKeyRecord[]> {
    const now = new Date();
    return this.listKeys(projectId).filter(key => 
      !key.revokedAt && key.expiresAt > now
    );
  }

  /**
   * Revoke API key before expiration
   */
  async revokeKey(projectId: string, keyId: string): Promise<void> {
    // Mark key as revoked
    await this.updateKeyStatus(keyId, { revokedAt: new Date() });
  }
}
```

**Documentation:**
```markdown
## API Key Token Expiration

API key tokens now expire after 90 days for security. When a token expires:
1. Refresh the token by generating a new one
2. Check the `expiresAt` field when generating keys
3. Set up alerts for expiring keys (at 80 days)
```

**Affected Files:**
- `backend/src/infra/security/token.manager.ts`
- `backend/src/services/secrets/api-key.service.ts` (new)
- Environment configuration

**Difficulty Level:** MEDIUM
**Estimated Time:** 3-4 hours
**Testing:** 2-3 hours (token lifecycle tests)

**Impact Assessment:**
- ✅ CRITICAL: Improves security posture
- ✅ Limits token compromise window
- ✅ Enables key rotation
- ✅ Provides audit trail
- ⚠️ BREAKING: Clients need key refresh logic

---

### 8. **Missing Mock Data Cleanup (LOW)**

**Issue Title:** Remove TODO and Mock Data from Production Code

**Description:**
Frontend deployment service contains TODO comment with reference to mock data that may be served in production.

**Current Code Problem:**
```typescript
// File: frontend/src/features/deployments/services/deployments.service.ts (Line 98)
// TODO: Remove mock data after testing
```

**Business Impact:**
- Unclear production code state
- Mock data might leak to production
- Confuses developers about production readiness

**Proposed Solution:**
Complete audit of the deployment service and remove or properly conditionally gate all mock data:

```typescript
// frontend/src/features/deployments/services/deployments.service.ts

// Remove TODO comment AND implement proper mock data handling:

const mockDeployments = [
  /* ... mock data ... */
];

export class DeploymentsService {
  // Only use mock data in development or when explicitly enabled
  private static useMockData(): boolean {
    // In production, never use mock data
    if (process.env.NODE_ENV === 'production') {
      return false;
    }
    // Allow opt-in through env var
    return process.env.VITE_USE_MOCK_DEPLOYMENTS === 'true';
  }

  async listDeployments(): Promise<DeploymentRecord[]> {
    if (DeploymentsService.useMockData()) {
      logger.debug('Using mock deployment data (dev mode)');
      return mockDeployments;
    }

    // Real API call
    return this.fetchDeploymentsFromAPI();
  }
}
```

**Affected Files:**
- `frontend/src/features/deployments/services/deployments.service.ts`
- `.env.example` (add VITE_USE_MOCK_DEPLOYMENTS flag)

**Difficulty Level:** EASY
**Estimated Time:** 30 minutes
**Testing:** 30 minutes

**Impact Assessment:**
- ✅ Clarifies production code state
- ✅ Prevents accidental mock data leaks
- ✅ Improves code clarity

---

## Summary Table

| Issue | Severity | Type | Time Est. | Impact | Files |
|-------|----------|------|-----------|--------|-------|
| Silent Errors in Transactions | HIGH | Reliability | 2-3 hrs | Critical | 4 files |
| Missing Graceful Shutdown | HIGH | Reliability | 3-4 hrs | High | 5+ services |
| S3 Config Hardcoding | MEDIUM | Ops | 1-2 hrs | Medium | 1 file |
| Unhandled Storage Errors | MEDIUM | Reliability | 2 hrs | Medium | Storage routes |
| Auth Error Context | MEDIUM | DX | 3-4 hrs | Medium | Auth service |
| Pool Health Checks | HIGH | Reliability | 4-5 hrs | High | 2 files |
| API Key Token Expiry | HIGH | Security | 3-4 hrs | Critical | 2 files |
| Mock Data Cleanup | LOW | Code Quality | 30 min | Low | 1 file |

## Estimated Total Implementation Time
- Implementation: **22-27 hours**
- Testing: **15-20 hours**
- Code Review: **5-10 hours**
- **Total: 42-57 hours of professional development work**

## How to Get Started

1. Start with **Issue #1 (Silent Errors)** - Most critical and high visibility
2. Then **Issue #7 (API Key Token)** - Security issue that should be prioritized
3. Then **Issue #2 (Graceful Shutdown)** - High operational impact
4. Then **Issue #6 (Pool Health)** - Improves reliability
5. Then **Issues #3, #4, #5** - Medium priority improvements

Each issue is designed to be implementable independently and would make an excellent individual pull request that demonstrates professional engineering practices.
