import { createClient, type InsForgeClient } from '@insforge/sdk';
import { getBackendUrl } from './utils';

const backendUrl = getBackendUrl();

export const insforge: InsForgeClient = createClient({
  baseUrl: backendUrl,
});
