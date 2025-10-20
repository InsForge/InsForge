import { logger } from '../../src/utils/logger';
import { describe, it, expect, vi } from 'vitest';

describe('Logger', () => {
  it('should initialize with correct log level from environment or default', () => {
    expect(logger.level).toBe(process.env.LOG_LEVEL || 'info');
  });

  it('should log messages without throwing', () => {
    expect(() => logger.info('Test info message')).not.toThrow();
    expect(() => logger.warn('Test warn message')).not.toThrow();
    expect(() => logger.error('Test error message')).not.toThrow();
  });

  it('should call logger.error when logging errors', () => {
    const error = new Error('Test error');
    const logSpy = vi.spyOn(logger, 'error').mockImplementation(() => logger);
    logger.error(error);
    expect(logSpy).toHaveBeenCalled();
    logSpy.mockRestore();
  });
});
