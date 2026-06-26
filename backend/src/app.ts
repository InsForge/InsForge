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
import { s3GatewayRouter } from '@/api/routes/s3-gateway/index.routes.js';
import { paymentsRouter } from '@/api/routes/payments/index.routes.js';
import { errorMiddleware } from '@/api/middlewares/error.js';
import { isCloudEnvironment } from '@/utils/environment.js';
import fetch from 'node-fetch';
import { DatabaseManager } from '@/infra/database/database.manager.js';
import { LogService } from '@/services/logs/log.service.js';
import { StorageService } from '@/services/storage/storage.service.js';
import { seedBackend } from '@/utils/seed.js';
import logger from '@/utils/logger.js';
import { initSqlParser } from '@/utils/sql-parser.js';
import { FunctionService } from '@/services/functions/function.service.js';
import packageJson from '../../package.json';
import { schedulesRouter } from '@/api/routes/schedules/index.routes.js';
import { servicesRouter } from '@/api/routes/compute/services.routes.js';
import { posthogRouter } from '@/api/routes/posthog/index.routes.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
let envLoaded = false;

function shouldSkipGlobalRateLimit(req: Request): boolean {
  if (req.path === '/api/health') {
    return true;
  }

  return (
    req.method === 'PUT' && /^\/api\/deployments\/[^/]+\/files\/[^/]+\/content$/.test(req.path)
  );
}

function loadEnvironment() {
  if (envLoaded) {
    return;
  }

  const envPath = path.resolve(__dirname, '../../.env');
  if (fs.existsSync(envPath)) {
    dotenv.config({ path: envPath });
  } else {
    dotenv.config();
  }

  envLoaded = true;
}

function shouldSkipRequestLog(pathname: string) {
  return pathname === '/api/logs' || pathname.startsWith('/api/logs/');
}

export async function createApp() {
  loadEnvironment();

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
    max: 3000,
    message: 'Too many requests from this IP',
    skip: shouldSkipGlobalRateLimit,
  });

  // Basic middleware
  app.use(
    cors({
      origin: true, // Allow all origins (matches Better Auth's trustedOrigins: ['*'])
      credentials: true, // Allow cookies/credentials
      exposedHeaders: ['Content-Range', 'Preference-Applied'],
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
      if (shouldSkipRequestLog(req.path)) {
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

  // Mount the S3 protocol gateway BEFORE JSON middleware so request bodies
  // stream through untouched. The gateway handles raw streams itself
  // (including STREAMING-AWS4-HMAC-SHA256-PAYLOAD chunked signatures).
  app.use('/storage/v1/s3', s3GatewayRouter);

  // Apply JSON and URL-encoded middleware for all other routes.
  // We use high defaults (100mb/10mb) to ensure a smooth "out-of-the-box" experience
  // for large metadata/storage requests, as per project standards.
  // Users can override these via environment variables for hardened security.
  const jsonLimit = process.env.MAX_JSON_BODY_SIZE || '100mb';
  const urlencodedLimit = process.env.MAX_URLENCODED_BODY_SIZE || '10mb';

  app.use(express.json({ limit: jsonLimit }));
  app.use(express.urlencoded({ extended: true, limit: urlencodedLimit }));

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
  apiRouter.use('/payments', paymentsRouter);
  apiRouter.use('/compute/services', servicesRouter);
  apiRouter.use('/integrations/posthog', posthogRouter);

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

      const hasBody = !['GET', 'HEAD'].includes(req.method) && req.body !== undefined;

      // Build headers, filtering out non-string values and overriding host
      const headers: Record<string, string> = {};
      for (const [key, value] of Object.entries(req.headers)) {
        const lowerKey = key.toLowerCase();
        if (
          ['host', 'content-length', 'transfer-encoding'].includes(lowerKey) ||
          (hasBody && lowerKey === 'content-type')
        ) {
          continue;
        }

        if (typeof value === 'string') {
          headers[key] = value;
        }
      }
      headers.host = targetUrl.host;

      const body = hasBody ? JSON.stringify(req.body) : undefined;
      if (body !== undefined) {
        headers['content-type'] = 'application/json';
      }

      const response = await fetch(targetUrl, {
        method: req.method,
        headers,
        body,
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
