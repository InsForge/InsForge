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

  async getSummary() {
    await Promise.resolve();
    return this.throwUnsupported();
  }

  async getRecentEvents() {
    await Promise.resolve();
    return this.throwUnsupported();
  }

  async disconnect() {
    await Promise.resolve();
    return this.throwUnsupported();
  }

  async getWebOverview() {
    await Promise.resolve();
    return this.throwUnsupported();
  }

  async getWebStats() {
    await Promise.resolve();
    return this.throwUnsupported();
  }

  async getTrends() {
    await Promise.resolve();
    return this.throwUnsupported();
  }

  async getRetention() {
    await Promise.resolve();
    return this.throwUnsupported();
  }

  async getRecordings() {
    await Promise.resolve();
    return this.throwUnsupported();
  }

  async createRecordingShare() {
    await Promise.resolve();
    return this.throwUnsupported();
  }
}
