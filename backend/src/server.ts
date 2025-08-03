/* eslint-disable no-console */
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
import { databaseRouter } from '@/api/routes/database.js';
import { storageRouter } from '@/api/routes/storage.js';
import { metadataRouter } from '@/api/routes/metadata.js';
import { logsRouter } from '@/api/routes/logs.js';
import { configRouter } from '@/api/routes/config.js';
import { docsRouter } from '@/api/routes/docs.js';
import functionsRouter from '@/api/routes/functions.js';
import { errorMiddleware } from '@/api/middleware/error.js';
import fetch from 'node-fetch';
import { DatabaseManager } from '@/core/database/database.js';
import { StorageService } from '@/core/storage/storage.js';
import { MetadataService } from '@/core/metadata/metadata.js';
import { seedAdmin } from '@/utils/seed.js';
// import { EtcdServiceRegistry } from '@/utils/etcd-service-registry.js';

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

  const app = express();

  const limiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 1000,
    message: 'Too many requests from this IP',
  });

  // Basic middleware
  app.use(cors());
  app.use(limiter);
  app.use((req: Request, _res: Response, next: NextFunction) => {
    console.log(`${new Date().toISOString()} - ${req.method} ${req.path}`);
    next();
  });

  // Mount Better Auth BEFORE express.json() middleware
  // This is required as per Better Auth documentation
  if (process.env.ENABLE_BETTER_AUTH === 'true') {
    const { toNodeHandler } = await import('better-auth/node');
    const { auth } = await import('@/lib/better-auth.js');
    // Better Auth handles its own body parsing
    app.all('/api/auth/v2/*', toNodeHandler(auth));
    console.log('Better Auth enabled at /api/auth/v2');
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
      console.error('Failed to execute function:', error);
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
        nextAction: 'Please check the API documentation for available endpoints',
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
    app.listen(PORT, () => {
      console.log(`Backend API service listening on port ${PORT}`);
    });
  } catch (error) {
    console.error('Failed to initialize server:', error);
    process.exit(1);
  }
}

void initializeServer();

function cleanup() {
  console.log('Shutting down gracefully...');
  process.exit(0);
}

process.on('SIGINT', cleanup);
process.on('SIGTERM', cleanup);
