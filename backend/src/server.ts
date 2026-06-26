import path from 'path';
import { fileURLToPath } from 'url';

import { destroyEmailCooldownInterval } from '@/api/middlewares/rate-limiters.js';
import { appConfig } from '@/infra/config/app.config.js';
import { RealtimeManager } from '@/infra/realtime/realtime.manager.js';
import { SocketManager } from '@/infra/socket/socket.manager.js';
import { OAuthPKCEService } from '@/services/auth/oauth-pkce.service.js';
import { FunctionService } from '@/services/functions/function.service.js';
import logger from '@/utils/logger.js';
import { createApp } from './app.js';

const __filename = fileURLToPath(import.meta.url);

function isEntrypoint() {
  const entrypoint = process.argv[1];
  return entrypoint ? path.resolve(entrypoint) === __filename : false;
}

async function initializeServer() {
  try {
    const app = await createApp();
    const PORT = appConfig.app.port;
    const server = app.listen(PORT, () => {
      logger.info(`Backend API service listening on port ${PORT}`);
    });

    // Initialize Socket.IO service
    const socketService = SocketManager.getInstance();
    socketService.initialize(server);

    // Initialize RealtimeManager (pg_notify listener)
    const realtimeManager = RealtimeManager.getInstance();
    await realtimeManager.initialize();

    // Sync existing functions to Deno Deploy (non-blocking)
    const functionService = FunctionService.getInstance();
    functionService.syncDeployment().catch((err) => {
      logger.error('Failed to sync functions to Deno Deploy', {
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

if (isEntrypoint()) {
  void initializeServer();
  process.on('SIGINT', () => void cleanup());
  process.on('SIGTERM', () => void cleanup());
}
