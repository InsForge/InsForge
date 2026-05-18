import { config } from '@/infra/config/app.config.js';
import { CloudPosthogProvider } from './cloud.provider.js';
import { LocalPosthogProvider } from './local.provider.js';
import type { PosthogProvider } from './base.provider.js';

export function getPosthogProvider(): PosthogProvider {
  const isCloud = !!config.cloud.projectId && config.cloud.projectId !== 'local';
  return isCloud ? CloudPosthogProvider.getInstance() : new LocalPosthogProvider();
}

export type { PosthogProvider } from './base.provider.js';
