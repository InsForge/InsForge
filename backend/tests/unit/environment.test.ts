import {
  isCloudEnvironment,
  isOAuthSharedKeysAvailable,
  isDevelopment,
  isProduction,
} from '../../src/utils/environment';

describe('Environment utils', () => {
  const OLD_ENV = process.env;

  beforeEach(() => {
    process.env = { ...OLD_ENV };
  });

  afterAll(() => {
    process.env = OLD_ENV;
  });

  test('isCloudEnvironment returns true if AWS_INSTANCE_PROFILE_NAME is set', () => {
    process.env.AWS_INSTANCE_PROFILE_NAME = 'my-profile';
    expect(isCloudEnvironment()).toBe(true);
  });

  test('isCloudEnvironment returns false if AWS_INSTANCE_PROFILE_NAME is missing', () => {
    delete process.env.AWS_INSTANCE_PROFILE_NAME;
    expect(isCloudEnvironment()).toBe(false);
  });

  test('isOAuthSharedKeysAvailable returns same as isCloudEnvironment', () => {
    process.env.AWS_INSTANCE_PROFILE_NAME = 'profile';
    expect(isOAuthSharedKeysAvailable()).toBe(true);

    delete process.env.AWS_INSTANCE_PROFILE_NAME;
    expect(isOAuthSharedKeysAvailable()).toBe(false);
  });

  test('isDevelopment works correctly', () => {
    process.env.NODE_ENV = 'development';
    expect(isDevelopment()).toBe(true);

    process.env.NODE_ENV = 'production';
    expect(isDevelopment()).toBe(false);

    delete process.env.NODE_ENV;
    expect(isDevelopment()).toBe(true);
  });

  test('isProduction works correctly', () => {
    process.env.NODE_ENV = 'production';
    expect(isProduction()).toBe(true);

    process.env.NODE_ENV = 'development';
    expect(isProduction()).toBe(false);

    delete process.env.NODE_ENV;
    expect(isProduction()).toBe(false);
  });
});
