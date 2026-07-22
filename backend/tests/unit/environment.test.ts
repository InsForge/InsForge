import { isCloudEnvironment, isOAuthSharedKeysAvailable } from '../../src/utils/environment';
import { describe, it, expect, beforeEach, afterAll } from 'vitest';

describe('Environment utils', () => {
  const OLD_ENV = process.env;

  beforeEach(() => {
    process.env = { ...OLD_ENV };
  });

  afterAll(() => {
    process.env = OLD_ENV;
  });

  it('isCloudEnvironment returns true if AWS_INSTANCE_PROFILE_NAME is set', () => {
    process.env.AWS_INSTANCE_PROFILE_NAME = 'my-profile';
    expect(isCloudEnvironment()).toBe(true);
  });

  it('isCloudEnvironment returns false if AWS_INSTANCE_PROFILE_NAME is missing', () => {
    delete process.env.AWS_INSTANCE_PROFILE_NAME;
    expect(isCloudEnvironment()).toBe(false);
  });

  it('isOAuthSharedKeysAvailable returns same as isCloudEnvironment', () => {
    process.env.AWS_INSTANCE_PROFILE_NAME = 'profile';
    expect(isOAuthSharedKeysAvailable()).toBe(true);

    delete process.env.AWS_INSTANCE_PROFILE_NAME;
    expect(isOAuthSharedKeysAvailable()).toBe(false);
  });
});
