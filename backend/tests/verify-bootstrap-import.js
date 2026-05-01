import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import logger from '@/utils/logger.js';

const currentDir = path.dirname(fileURLToPath(import.meta.url));
const bootstrapPath = path.resolve(
  currentDir,
  '../src/infra/database/migrations/bootstrap/bootstrap-migrations.js'
);

if (!fs.existsSync(bootstrapPath)) {
  throw new Error(`Bootstrap migration script not found at: ${bootstrapPath}`);
}

if (typeof logger.info !== 'function') {
  throw new Error('Failed to resolve bootstrap logger dependency via tsx path aliases');
}

console.log('Bootstrap import path OK');
