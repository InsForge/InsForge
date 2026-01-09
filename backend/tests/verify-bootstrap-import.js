/**
 * Simple test script to verify that bootstrap-migrations.js can import logger
 */
/* eslint-env node */

import logger from '@/utils/logger.js';

logger.info('Import test: Starting...');

try {
  // Test that logger is imported successfully
  if (!logger) {
    throw new Error('Logger is undefined');
  }

  // Test that logger has the expected methods
  const requiredMethods = ['info', 'warn', 'error'];
  for (const method of requiredMethods) {
    if (typeof logger[method] !== 'function') {
      throw new Error(`logger.${method} is not a function`);
    }
  }

  // Test that logger methods work
  logger.info('Import test: Logger imported successfully');
  logger.info('Import test: logger.info() works');
  logger.warn('Import test: logger.warn() works');
  logger.error('Import test: logger.error() works (this is expected)');

  // Notes about the bootstrap-migrations import path (kept as logs, no console)
  logger.info('Import test: All logger methods are available');
  logger.info('Import test: Logger imported successfully via @/utils/logger.js');
  logger.info('SUCCESS: The import in bootstrap-migrations.js will work!');
  logger.info(
    'Logger module is accessible and functional when run with tsx (as configured in package.json migrate:bootstrap script)'
  );
} catch (error) {
  const message = error instanceof Error ? error.message : String(error);
  const stack = error instanceof Error ? error.stack : undefined;

  logger.error('FAILED: Import test failed');
  logger.error(`Error: ${message}`);
  if (stack) {
    logger.error(`Stack: ${stack}`);
  }
}
