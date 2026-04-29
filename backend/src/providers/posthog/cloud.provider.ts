import { AppError } from '@/api/middlewares/error.js';
import { ERROR_CODES } from '@/types/error-constants.js';
import type { PosthogProvider } from './base.provider.js';

/**
 * CloudPosthogProvider — fully implemented in Task F3.
 * This file exists so the factory in `index.ts` compiles before F3 lands.
 */
export class CloudPosthogProvider implements PosthogProvider {
  private static instance: CloudPosthogProvider;

  private constructor() {}

  static getInstance(): CloudPosthogProvider {
    if (!CloudPosthogProvider.instance) {
      CloudPosthogProvider.instance = new CloudPosthogProvider();
    }
    return CloudPosthogProvider.instance;
  }

  private notImplemented(): never {
    throw new AppError(
      'CloudPosthogProvider not yet implemented',
      501,
      ERROR_CODES.NOT_IMPLEMENTED
    );
  }

  async getConnection() {
    await Promise.resolve();
    return this.notImplemented();
  }

  async getDashboards() {
    await Promise.resolve();
    return this.notImplemented();
  }

  async disconnect() {
    await Promise.resolve();
    return this.notImplemented();
  }
}
