import express, { Request, Response, NextFunction } from 'express';
import cors from 'cors';
import rateLimit from 'express-rate-limit';
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';
import fs from 'fs';
import authRouter from '@/api/routes/auth.js';
import { databaseTablesRouter } from '@/api/routes/database.tables.js';
import { databaseRecordsRouter } from '@/api/routes/database.records.js';
import databaseAdvanceRouter from '@/api/routes/database.advance.js';
import { storageRouter } from '@/api/routes/storage.js';
import { metadataRouter } from '@/api/routes/metadata.js';
import { logsRouter } from '@/api/routes/logs.js';
import { docsRouter } from '@/api/routes/docs.js';
import functionsRouter from '@/api/routes/functions.js';
import secretsRouter from '@/api/routes/secrets.js';
import { usageRouter } from '@/api/routes/usage.js';
import { openAPIRouter } from '@/api/routes/openapi.js';
import { agentDocsRouter } from '@/api/routes/agent.js';
import { aiRouter } from '@/api/routes/ai.js';
import { errorMiddleware } from '@/api/middleware/error.js';
import fetch, { HeadersInit } from 'node-fetch';
import { DatabaseManager } from '@/core/database/manager.js';
import { LogService } from '@/core/logs/logs.js';
import { StorageService } from '@/core/storage/storage.js';
import { SocketService } from '@/core/socket/socket.js';
import { seedBackend } from '@/utils/seed.js';
import logger from '@/utils/logger.js';
import { isProduction } from './utils/environment';
import packageJson from '../../package.json';

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

  // Metadata is now handled by individual modules on-demand

  // Initialize logs service
  const logService = LogService.getInstance();
  await logService.initialize(); // connect to CloudWatch

  const app = express();

  // Enable trust proxy setting for rate limiting behind proxies/load balancers
  app.set('trust proxy', true);

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
  if (isProduction()) {
    app.use(limiter);
  }
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

  // Apply JSON middleware
  app.use(express.json({ limit: '100mb' }));
  app.use(express.urlencoded({ extended: true, limit: '10mb' }));

  // Create API router and mount all API routes under /api
  const apiRouter = express.Router();

  apiRouter.get('/health', (_req: Request, res: Response) => {
    // Traditional REST: return data directly
    const version = packageJson.version;
    res.json({
      status: 'ok',
      version,
      service: 'Insforge OSS Backend',
      timestamp: new Date().toISOString(),
    });
  });

  // Mount auth routes
  apiRouter.use('/auth', authRouter);
  apiRouter.use('/database/tables', databaseTablesRouter);
  apiRouter.use('/database/records', databaseRecordsRouter);
  apiRouter.use('/database/advance', databaseAdvanceRouter);
  apiRouter.use('/storage', storageRouter);
  apiRouter.use('/metadata', metadataRouter);
  apiRouter.use('/logs', logsRouter);
  apiRouter.use('/docs', docsRouter);
  apiRouter.use('/functions', functionsRouter);
  apiRouter.use('/secrets', secretsRouter);
  apiRouter.use('/usage', usageRouter);
  apiRouter.use('/openapi', openAPIRouter);
  apiRouter.use('/agent-docs', agentDocsRouter);
  apiRouter.use('/ai', aiRouter);

  // Mount all API routes under /api prefix
  app.use('/api', apiRouter);

  // Add direct OpenAPI route at /openapi
  app.get('/openapi', async (_req: Request, res: Response) => {
    try {
      const { OpenAPIService } = await import('@/core/documentation/openapi.js');
      const openAPIService = OpenAPIService.getInstance();
      const openAPIDocument = await openAPIService.generateOpenAPIDocument();
      res.json(openAPIDocument);
    } catch {
      res.status(500).json({ error: 'Failed to generate OpenAPI document' });
    }
  });

  // Add direct AI agent documentation route at /agent-docs
  app.get('/agent-docs', async (_req: Request, res: Response) => {
    try {
      const { AgentAPIDocService } = await import('@/core/documentation/agent.js');
      const agentAPIDocService = AgentAPIDocService.getInstance();
      const agentDocs = await agentAPIDocService.generateAgentDocumentation();
      res.json(agentDocs);
    } catch {
      res.status(500).json({ error: 'Failed to generate agent API documentation' });
    }
  });

  // Proxy function execution to Deno runtime
  app.all('/functions/:slug', async (req: Request, res: Response) => {
    try {
      const { slug } = req.params;
      const denoUrl = process.env.DENO_RUNTIME_URL || 'http://localhost:7133';

      // Simple direct proxy - just pass everything through
      const response = await fetch(
        `${denoUrl}/${slug}${req.url.includes('?') ? req.url.substring(req.url.indexOf('?')) : ''}`,
        {
          method: req.method,
          headers: req.headers as HeadersInit,
          body: ['GET', 'HEAD'].includes(req.method) ? undefined : JSON.stringify(req.body),
        }
      );

      // Get response text
      const responseText = await response.text();

      res
        .status(response.status)
        .set('Content-Type', response.headers.get('content-type') || 'application/json')
        .set('Access-Control-Allow-Origin', '*')
        .send(responseText);
    } catch (error) {
      logger.error('Failed to proxy to Deno runtime', {
        error: error instanceof Error ? error.message : String(error),
        stack: error instanceof Error ? error.stack : undefined,
        slug: req.params.slug,
      });

      // Return the actual error from Deno or connection error
      const errorMessage = error instanceof Error ? error.message : String(error);
      res.status(502).json({
        error: errorMessage,
      });
    }
  });

  // Serve auth app
  const authAppPath = path.join(__dirname, 'auth');
  if (fs.existsSync(authAppPath)) {
    app.use('/auth', express.static(authAppPath));
    app.get('/auth*', (_req: Request, res: Response) => {
      res.sendFile(path.join(authAppPath, 'index.html'));
    });
  } else if (!isProduction()) {
    const authAppUrl = process.env.AUTH_APP_URL || 'http://localhost:7132';
    logger.info('Auth app not built, proxying to development server', { authAppUrl });
  }

  // Serve main frontend if it exists
  const frontendPath = path.join(__dirname, 'frontend');
  if (fs.existsSync(frontendPath)) {
    app.use(['/cloud', '/dashboard'], express.static(frontendPath, { index: false }));
    app.use('/assets', express.static(path.join(frontendPath, 'assets')));
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
    const socketService = SocketService.getInstance();
    socketService.initialize(server);
  } catch (error) {
    logger.error('Failed to initialize server', {
      error: error instanceof Error ? error.message : String(error),
      stack: error instanceof Error ? error.stack : undefined,
    });
    process.exit(1);
  }
}

void initializeServer();

function cleanup() {
  logger.info('Shutting down gracefully...');
  process.exit(0);
}

process.on('SIGINT', cleanup);
process.on('SIGTERM', cleanup);
