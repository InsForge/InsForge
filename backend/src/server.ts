import express, { Request, Response, NextFunction } from 'express';
import cors from 'cors';
import rateLimit from 'express-rate-limit';
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';
import fs from 'fs';
import { authRouter } from '@/api/routes/auth.js';
import { profileRouter } from '@/api/routes/profile.js';
import { tablesRouter } from '@/api/routes/tables.js';
import { databaseRouter } from '@/api/routes/records.js';
import { storageRouter } from '@/api/routes/storage.js';
import { metadataRouter } from '@/api/routes/metadata.js';
import { logsRouter } from '@/api/routes/logs.js';
import { configRouter } from '@/api/routes/config.js';
import { docsRouter } from '@/api/routes/docs.js';
import functionsRouter from '@/api/routes/functions.js';
import { errorMiddleware } from '@/api/middleware/error.js';
import fetch from 'node-fetch';
import { DatabaseManager } from '@/core/database/database.js';
import { AnalyticsManager } from '@/core/analytics/analytics.js';
import { StorageService } from '@/core/storage/storage.js';
import { MetadataService } from '@/core/metadata/metadata.js';
import { WebSocketService } from '@/core/websocket/websocket.js';
import { seedAdmin } from '@/utils/seed.js';
import logger from '@/utils/logger.js';

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

  // Initialize metadata service
  const metadataService = MetadataService.getInstance();
  await metadataService.initialize(); // populate _metadata table

  // Initialize analytics service
  const analyticsManager = AnalyticsManager.getInstance();
  await analyticsManager.initialize(); // connect to _insforge database

  const app = express();

  const limiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 1000,
    message: 'Too many requests from this IP',
  });

  // Basic middleware
  app.use(cors());
  app.use(limiter);
  app.use((req: Request, res: Response, next: NextFunction) => {
    const startTime = Date.now();
    const originalSend = res.send;
    const originalJson = res.json;

    // Track response size
    let responseSize = 0;

    // Override send method
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    res.send = function (data: any) {
      if (data) {
        responseSize = Buffer.byteLength(typeof data === 'string' ? data : JSON.stringify(data));
      }
      return originalSend.call(this, data);
    };
    // Override json method
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    res.json = function (data: any) {
      if (data) {
        responseSize = Buffer.byteLength(JSON.stringify(data));
      }
      return originalJson.call(this, data);
    };
    // Log after response is finished
    res.on('finish', () => {
      // Skip logging for analytics endpoints to avoid infinite loops
      if (req.path.includes('/analytics/')) {
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

  // Mount Better Auth BEFORE express.json() middleware
  // This is required as per Better Auth documentation
  if (process.env.ENABLE_BETTER_AUTH === 'true') {
    const { toNodeHandler } = await import('better-auth/node');
    const { auth } = await import('@/lib/better-auth.js');
    // Better Auth handles its own body parsing
    app.all('/api/auth/v2/*', toNodeHandler(auth));
    logger.info('Better Auth enabled at /api/auth/v2');
  }

  // Apply JSON middleware after Better Auth
  app.use(express.json({ limit: '100mb' }));
  app.use(express.urlencoded({ extended: true, limit: '10mb' }));

  // Create API router and mount all API routes under /api
  const apiRouter = express.Router();

  apiRouter.get('/health', (_req: Request, res: Response) => {
    // Traditional REST: return data directly
    res.json({
      status: 'ok',
      service: 'Insforge Backend',
      timestamp: new Date().toISOString(),
    });
  });

  apiRouter.use('/auth', authRouter);
  apiRouter.use('/profiles', profileRouter);
  apiRouter.use('/database/tables', tablesRouter);
  apiRouter.use('/database/records', databaseRouter);
  apiRouter.use('/storage', storageRouter);
  apiRouter.use('/metadata', metadataRouter);
  apiRouter.use('/logs', logsRouter);
  apiRouter.use('/config', configRouter);
  apiRouter.use('/docs', docsRouter);
  apiRouter.use('/functions', functionsRouter);

  // Mount all API routes under /api prefix
  app.use('/api', apiRouter);

  // Proxy function execution to Deno runtime
  app.all('/functions/:slug', async (req: Request, res: Response) => {
    try {
      const { slug } = req.params;
      const denoUrl = process.env.DENO_RUNTIME_URL || 'http://localhost:7133';
      const queryString = new URL(req.url, `http://localhost`).search;

      // Convert headers to fetch-compatible format
      const headers: Record<string, string> = {};
      Object.entries(req.headers).forEach(([key, value]) => {
        if (value) {
          headers[key] = Array.isArray(value) ? value.join(', ') : String(value);
        }
      });
      headers['X-Forwarded-For'] = req.ip || req.socket.remoteAddress || '';
      headers['X-Original-Host'] = req.hostname;

      const response = await fetch(`${denoUrl}/${slug}${queryString}`, {
        method: req.method,
        headers,
        body: ['GET', 'HEAD'].includes(req.method) ? undefined : JSON.stringify(req.body),
      });

      // Copy response headers
      for (const [key, value] of response.headers.entries()) {
        res.setHeader(key, value);
      }

      res.status(response.status).send(await response.text());
    } catch (error) {
      logger.error('Failed to execute function', {
        error: error instanceof Error ? error.message : String(error),
        stack: error instanceof Error ? error.stack : undefined,
      });
      res.status(502).json({ error: 'Failed to execute function' });
    }
  });

  // Always try to serve frontend if it exists
  const frontendPath = path.join(__dirname, 'frontend');

  // Check if frontend build exists
  if (fs.existsSync(frontendPath)) {
    // Catch all handler for SPA routes
    app.get('/dashboard*', (_req: Request, res: Response) => {
      res.sendFile(path.join(frontendPath, 'index.html'));
    });
    app.use(express.static(frontendPath));
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
  await seedAdmin();

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

    // Initialize WebSocket service
    const wsService = WebSocketService.getInstance();
    wsService.initialize(server);
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
