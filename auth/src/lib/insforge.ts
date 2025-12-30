import { createClient } from '@insforge/sdk';
import { getBackendUrl } from './utils';

const backendUrl = getBackendUrl();

export const insforge = createClient({
  baseUrl: backendUrl,
});
