/* eslint-disable no-console */
import 'dotenv/config';
import express, { Request, Response, NextFunction } from 'express';
import cors from 'cors';
import rateLimit from 'express-rate-limit';
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';
import fs from 'fs';
import { authRouter } from './routes/auth.js';
import { profileRouter } from './routes/profile.js';
import { tablesRouter } from './routes/tables.js';
import { databaseRouter } from './routes/database.js';
import { storageRouter } from './routes/storage.js';
import { metadataRouter } from './routes/metadata.js';
import { logsRouter } from './routes/logs.js';
import { configRouter } from './routes/config.js';
import { docsRouter } from './routes/docs.js';
import functionsRouter from './routes/functions.js';
import { vaultRouter } from './routes/vault.js';
import { errorMiddleware } from './middleware/error.js';
import fetch from 'node-fetch';
import { DatabaseManager } from './services/database.js';
import { StorageService } from './services/storage.js';
import { MetadataService } from './services/metadata.js';
import { seedAdmin } from './utils/seed.js';
import { EtcdServiceRegistry } from './utils/etcd-service-registry.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

dotenv.config();

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
    max: 500,
    message: 'Too many requests from this IP',
  });

  // Basic middleware
  app.use(cors());
  app.use(express.json({ limit: '100mb' }));
  app.use(express.urlencoded({ extended: true, limit: '10mb' }));
  app.use(limiter);
  app.use((req: Request, _res: Response, next: NextFunction) => {
    console.log(`${new Date().toISOString()} - ${req.method} ${req.path}`);
    next();
  });

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
  apiRouter.use('/vault', vaultRouter);

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
    app.use(express.static(frontendPath));

    // Catch all handler for SPA routes
    app.get('*', (_req: Request, res: Response) => {
      res.sendFile(path.join(frontendPath, 'index.html'));
    });
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

const APP_KEY = process.env.APP_KEY || '';
const ETCD_HOSTS = process.env.ETCD_HOSTS || '';
const ETCD_USERNAME = process.env.ETCD_USERNAME || '';
const ETCD_PASSWORD = process.env.ETCD_PASSWORD || '';
const ETCD_TIMEOUT = parseInt(process.env.ETCD_TIMEOUT || '5000');

const serviceRegistry = new EtcdServiceRegistry({
  appKey: APP_KEY,
  port: PORT,
  etcdHosts: ETCD_HOSTS,
  etcdUsername: ETCD_USERNAME,
  etcdPassword: ETCD_PASSWORD,
  etcdTimeout: ETCD_TIMEOUT,
});

async function initializeServer() {
  try {
    const app = await createApp();
    app.listen(PORT, async () => {
      console.log(`Backend API service listening on port ${PORT} with APP_KEY: ${APP_KEY}`);
      await serviceRegistry.register();
    });
  } catch (error) {
    console.error('Failed to initialize server:', error);
    process.exit(1);
  }
}

void initializeServer();

async function cleanup() {
  console.log('Shutting down gracefully...');
  await serviceRegistry.unregister();
  process.exit(0);
}

process.on('SIGINT', cleanup);
process.on('SIGTERM', cleanup);
