import { AppError } from '@/api/middlewares/error.js';
import { ERROR_CODES } from '@/types/error-constants.js';
import type { PosthogProvider } from './base.provider.js';

export class LocalPosthogProvider implements PosthogProvider {
  private throwUnsupported(): never {
    throw new AppError(
      'PostHog integration is only available on Insforge Cloud, not in self-hosted mode.',
      501,
      ERROR_CODES.NOT_IMPLEMENTED
    );
  }

  async getConnection() {
    await Promise.resolve();
    return this.throwUnsupported();
  }

  async getDashboards() {
    await Promise.resolve();
    return this.throwUnsupported();
  }

  async disconnect() {
    await Promise.resolve();
    return this.throwUnsupported();
  }
}
