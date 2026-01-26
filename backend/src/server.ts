import express, { Request, Response, NextFunction } from 'express';
import cors from 'cors';
import cookieParser from 'cookie-parser';
import rateLimit from 'express-rate-limit';
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';
import fs from 'fs';
import authRouter from '@/api/routes/auth/index.routes.js';
import databaseRouter from '@/api/routes/database/index.routes.js';
import { storageRouter } from '@/api/routes/storage/index.routes.js';
import { metadataRouter } from '@/api/routes/metadata/index.routes.js';
import { logsRouter } from '@/api/routes/logs/index.routes.js';
import { docsRouter } from '@/api/routes/docs/index.routes.js';
import functionsRouter from '@/api/routes/functions/index.routes.js';
import secretsRouter from '@/api/routes/secrets/index.routes.js';
import { usageRouter } from '@/api/routes/usage/index.routes.js';
import { aiRouter } from '@/api/routes/ai/index.routes.js';
import { realtimeRouter } from '@/api/routes/realtime/index.routes.js';
import { emailRouter } from '@/api/routes/email/index.routes.js';
import { deploymentsRouter } from '@/api/routes/deployments/index.routes.js';
import { webhooksRouter } from '@/api/routes/webhooks/index.routes.js';
import { errorMiddleware } from '@/api/middlewares/error.js';
import { destroyEmailCooldownInterval } from '@/api/middlewares/rate-limiters.js';
import { isCloudEnvironment } from '@/utils/environment.js';
import { RealtimeManager } from '@/infra/realtime/realtime.manager.js';
import fetch from 'node-fetch';
import { DatabaseManager } from '@/infra/database/database.manager.js';
import { LogService } from '@/services/logs/log.service.js';
import { StorageService } from '@/services/storage/storage.service.js';
import { SocketManager } from '@/infra/socket/socket.manager.js';
import { OAuthPKCEService } from '@/services/auth/oauth-pkce.service.js';
import { seedBackend } from '@/utils/seed.js';
import logger from '@/utils/logger.js';
import { initSqlParser } from '@/utils/sql-parser.js';
import { FunctionService } from '@/services/functions/function.service.js';
import packageJson from '../../package.json';
import { schedulesRouter } from '@/api/routes/schedules/index.routes.js';
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Load .env file from the root directory (parent of backend)
const envPath = path.resolve(__dirname, '../../.env');
if (fs.existsSync(envPath)) {
  dotenv.config({ path: envPath });
} else {
  // Fallback to default behavior (looks in current working directory)
  dotenv.config();
}

export async function createApp() {
  // Initialize database first
  const dbManager = DatabaseManager.getInstance();
  await dbManager.initialize(); // create data/app.db

  // Initialize storage service
  const storageService = StorageService.getInstance();
  await storageService.initialize(); // create data/storage

  // Initialize logs service
  const logService = LogService.getInstance();
  await logService.initialize(); // connect to CloudWatch

  // Initialize SQL parser WASM module
  await initSqlParser();

  const app = express();

  // Enable trust proxy setting for rate limiting behind proxies/load balancers
  app.set('trust proxy', 2);

  const limiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 1000,
    message: 'Too many requests from this IP',
  });

  // Basic middleware
  app.use(
    cors({
      origin: true, // Allow all origins (matches Better Auth's trustedOrigins: ['*'])
      credentials: true, // Allow cookies/credentials
    })
  );
  app.use(cookieParser()); // Parse cookies for refresh token handling
  app.use(limiter);
  app.use((req: Request, res: Response, next: NextFunction) => {
    const startTime = Date.now();
    const originalSend = res.send;
    const originalJson = res.json;

    // Track response size
    let responseSize = 0;

    // Override send method
    res.send = function (
      data: string | Buffer | Record<string, unknown> | unknown[] | number | boolean
    ) {
      if (data !== undefined && data !== null) {
        if (typeof data === 'string') {
          responseSize = Buffer.byteLength(data);
        } else if (Buffer.isBuffer(data)) {
          responseSize = data.length;
        } else if (typeof data === 'number' || typeof data === 'boolean') {
          responseSize = Buffer.byteLength(String(data));
        } else {
          try {
            responseSize = Buffer.byteLength(JSON.stringify(data));
          } catch {
            // Handle circular references or unstringifiable objects
            responseSize = 0;
          }
        }
      }
      return originalSend.call(this, data);
    };

    // Override json method
    res.json = function (
      data: Record<string, unknown> | unknown[] | string | number | boolean | null
    ) {
      if (data !== undefined) {
        try {
          responseSize = Buffer.byteLength(JSON.stringify(data));
        } catch {
          // Handle circular references or unstringifiable objects
          responseSize = 0;
        }
      }
      return originalJson.call(this, data);
    };

    // Log after response is finished
    res.on('finish', () => {
      // Skip logging for logs endpoints to avoid infinite loops
      if (req.path.includes('/logs/')) {
        return;
      }

      const duration = Date.now() - startTime;
      logger.info('HTTP Request', {
        method: req.method,
        path: req.path,
        status: res.statusCode,
        size: responseSize,
        duration: `${duration}ms`,
        ip: req.ip || req.socket.remoteAddress,
        userAgent: req.headers['user-agent'],
        timestamp: new Date().toISOString(),
      });
    });

    next();
  });

  // Mount webhooks with raw body parser BEFORE JSON middleware
  // This ensures signature verification uses the original bytes
  app.use('/api/webhooks', express.raw({ type: 'application/json' }), webhooksRouter);

  // Apply JSON middleware for all other routes
  app.use(express.json({ limit: '100mb' }));
  app.use(express.urlencoded({ extended: true, limit: '10mb' }));

  // Create API router and mount all API routes under /api
  const apiRouter = express.Router();

  apiRouter.get('/health', (_req: Request, res: Response) => {
    const version = packageJson.version;
    res.json({
      status: 'ok',
      version,
      service: 'Insforge OSS Backend',
      timestamp: new Date().toISOString(),
    });
  });

  // Mount all routes
  apiRouter.use('/auth', authRouter);
  apiRouter.use('/database', databaseRouter);
  apiRouter.use('/storage', storageRouter);
  apiRouter.use('/metadata', metadataRouter);
  apiRouter.use('/logs', logsRouter);
  apiRouter.use('/docs', docsRouter);
  apiRouter.use('/functions', functionsRouter);
  apiRouter.use('/secrets', secretsRouter);
  apiRouter.use('/usage', usageRouter);
  apiRouter.use('/ai', aiRouter);
  apiRouter.use('/realtime', realtimeRouter);
  apiRouter.use('/email', emailRouter);
  apiRouter.use('/deployments', deploymentsRouter);
  apiRouter.use('/schedules', schedulesRouter);

  // Mount all API routes under /api prefix
  app.use('/api', apiRouter);

  // Proxy function execution to Deno Subhosting or local runtime
  // this logic is used for backward compatibility, we will let the sdk directly call the edge function
  app.all('/functions/:slug', async (req: Request, res: Response) => {
    const { slug } = req.params;

    try {
      const functionService = FunctionService.getInstance();
      const localRuntime = process.env.DENO_RUNTIME_URL || 'http://localhost:7133';

      // Get target base URL: prefer Subhosting deployment, fallback to local runtime
      const baseUrl =
        (functionService.isSubhostingConfigured() && (await functionService.getDeploymentUrl())) ||
        localRuntime;

      // Build target URL with query string
      const targetUrl = new URL(`/${slug}`, baseUrl);
      targetUrl.search = new URL(req.url, `http://${req.headers.host}`).search;

      // Build headers, filtering out non-string values and overriding host
      const headers: Record<string, string> = {};
      for (const [key, value] of Object.entries(req.headers)) {
        if (typeof value === 'string') {
          headers[key] = value;
        }
      }
      headers.host = targetUrl.host;

      const response = await fetch(targetUrl, {
        method: req.method,
        headers,
        body: ['GET', 'HEAD'].includes(req.method) ? undefined : JSON.stringify(req.body),
      });

      // Read response as raw bytes to preserve binary data (images, PDFs, etc.)
      const responseBody = Buffer.from(await response.arrayBuffer());

      // Forward response headers, excluding:
      // - transfer-encoding, content-length: recalculated by Express
      // - connection: hop-by-hop header
      // - content-encoding: node-fetch already decompresses the response,
      //   so we must not tell the client it's still compressed
      const responseHeaders: Record<string, string> = {};
      for (const [key, value] of response.headers.entries()) {
        if (
          ['transfer-encoding', 'content-length', 'connection', 'content-encoding'].includes(key)
        ) {
          continue;
        }
        responseHeaders[key] = value;
      }

      res
        .status(response.status)
        .set(responseHeaders)
        .set('Access-Control-Allow-Origin', '*')
        .send(responseBody);
    } catch (error) {
      logger.error('Failed to proxy function', { slug, error: String(error) });
      res.status(502).json({ error: error instanceof Error ? error.message : String(error) });
    }
  });

  // Serve auth app
  const authAppPath = path.join(__dirname, 'auth');
  if (fs.existsSync(authAppPath)) {
    app.use('/auth', express.static(authAppPath));
    app.get('/auth*', (_req: Request, res: Response) => {
      res.sendFile(path.join(authAppPath, 'index.html'));
    });
  } else {
    const authAppUrl = process.env.AUTH_APP_URL || 'http://localhost:7132';
    logger.info('Auth app not built, proxying to development server', { authAppUrl });
  }

  // Redirect root to dashboard login (only for non-insforge cloud environments)
  if (!isCloudEnvironment()) {
    app.get('/', (_req: Request, res: Response) => {
      res.redirect('/dashboard/login');
    });
  }

  // Serve main frontend if it exists
  const frontendPath = path.join(__dirname, 'frontend');
  if (fs.existsSync(frontendPath)) {
    app.use(express.static(frontendPath, { index: false }));
    // Catch all handler for SPA routes
    app.get(['/cloud*', '/dashboard*'], (_req: Request, res: Response) => {
      res.sendFile(path.join(frontendPath, 'index.html'));
    });
  } else {
    // Catch-all for 404 errors - Traditional REST format
    app.use('*', (req: Request, res: Response) => {
      res.status(404).json({
        error: 'NOT_FOUND',
        message: `Endpoint ${req.originalUrl} not found`,
        statusCode: 404,
        nextActions: 'Please check the API documentation for available endpoints',
      });
    });
  }

  app.use(errorMiddleware);
  await seedBackend();

  return app;
}

// Use PORT from environment variable, fallback to 7130
const PORT = parseInt(process.env.PORT || '7130');

async function initializeServer() {
  try {
    const app = await createApp();
    const server = app.listen(PORT, () => {
      logger.info(`Backend API service listening on port ${PORT}`);
    });

    // Initialize Socket.IO service
    const socketService = SocketManager.getInstance();
    socketService.initialize(server);

    // Initialize RealtimeManager (pg_notify listener)
    const realtimeManager = RealtimeManager.getInstance();
    await realtimeManager.initialize();

    // Sync existing functions to Deno Subhosting (non-blocking)
    const functionService = FunctionService.getInstance();
    functionService.syncDeployment().catch((err) => {
      logger.error('Failed to sync functions to Deno Subhosting', {
        error: err instanceof Error ? err.message : String(err),
      });
    });
  } catch (error) {
    logger.error('Failed to initialize server', {
      error: error instanceof Error ? error.message : String(error),
      stack: error instanceof Error ? error.stack : undefined,
    });
    process.exit(1);
  }
}

void initializeServer();

async function cleanup() {
  logger.info('Shutting down gracefully...');

  try {
    const realtimeManager = RealtimeManager.getInstance();
    await realtimeManager.close();
  } catch (error) {
    logger.error('Error closing RealtimeManager', {
      error: error instanceof Error ? error.message : String(error),
    });
  }

  try {
    const socketService = SocketManager.getInstance();
    socketService.close();
  } catch (error) {
    logger.error('Error closing SocketManager', {
      error: error instanceof Error ? error.message : String(error),
    });
  }

  try {
    const oAuthPKCEService = OAuthPKCEService.getInstance();
    oAuthPKCEService.destroy();
  } catch (error) {
    logger.error('Error closing OAuthPKCEService', {
      error: error instanceof Error ? error.message : String(error),
    });
  }

  try {
    destroyEmailCooldownInterval();
  } catch (error) {
    logger.error('Error clearing email cooldown interval', {
      error: error instanceof Error ? error.message : String(error),
    });
  }

  process.exit(0);
}

process.on('SIGINT', () => void cleanup());
process.on('SIGTERM', () => void cleanup());
