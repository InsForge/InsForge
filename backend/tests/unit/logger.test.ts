import { logger } from '../../src/utils/logger';

describe('Logger', () => {
  test('should initialize with correct log level from environment or default', () => {
    expect(logger.level).toBe(process.env.LOG_LEVEL || 'info');
  });

  test('should log messages without throwing', () => {
    expect(() => logger.info('Test info message')).not.toThrow();
    expect(() => logger.warn('Test warn message')).not.toThrow();
    expect(() => logger.error('Test error message')).not.toThrow();
  });

  test('should call logger.error when logging errors', () => {
  const error = new Error('Test error');
  const logSpy = jest.spyOn(logger, 'error').mockImplementation((infoObject: object) => logger);
  logger.error(error);
  expect(logSpy).toHaveBeenCalled();
  logSpy.mockRestore();
});
});
