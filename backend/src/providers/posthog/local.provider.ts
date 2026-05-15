import { AppError } from '@/api/middlewares/error.js';
import { ERROR_CODES } from '@/types/error-constants.js';
import type { PosthogProvider } from './base.provider.js';

function unsupported(): Promise<never> {
  return Promise.reject(
    new AppError(
      'PostHog integration is only available on Insforge Cloud, not in self-hosted mode.',
      501,
      ERROR_CODES.NOT_IMPLEMENTED
    )
  );
}

export class LocalPosthogProvider implements PosthogProvider {
  getConnection() {
    return unsupported();
  }
  getDashboards() {
    return unsupported();
  }
  getSummary() {
    return unsupported();
  }
  getRecentEvents() {
    return unsupported();
  }
  disconnect() {
    return unsupported();
  }
  getWebOverview() {
    return unsupported();
  }
  getWebStats() {
    return unsupported();
  }
  getTrends() {
    return unsupported();
  }
  getRetention() {
    return unsupported();
  }
  getRecordings() {
    return unsupported();
  }
  createRecordingShare() {
    return unsupported();
  }
}
