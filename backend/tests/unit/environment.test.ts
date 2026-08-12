import {
  isCloudEnvironment,
  isCloudProject,
  isOAuthSharedKeysAvailable,
  isDevelopment,
  isProduction,
} from '../../src/utils/environment';
import { appConfig } from '../../src/infra/config/app.config';
import { describe, it, expect, beforeEach, afterEach, afterAll } from 'vitest';

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

  it('isDevelopment works correctly', () => {
    process.env.NODE_ENV = 'development';
    expect(isDevelopment()).toBe(true);

    process.env.NODE_ENV = 'production';
    expect(isDevelopment()).toBe(false);

    process.env.NODE_ENV = 'test';
    expect(isDevelopment()).toBe(false);

    delete process.env.NODE_ENV;
    expect(isDevelopment()).toBe(false);
  });

  it('isProduction works correctly', () => {
    process.env.NODE_ENV = 'production';
    expect(isProduction()).toBe(true);

    process.env.NODE_ENV = 'development';
    expect(isProduction()).toBe(false);

    delete process.env.NODE_ENV;
    expect(isProduction()).toBe(false);
  });

  // A PaaS template that sets PROJECT_ID (Zeabur does) is still a self-host, so the
  // project id alone must not answer this.
  describe('isCloudProject', () => {
    let savedProjectId: string | undefined;

    beforeEach(() => {
      savedProjectId = appConfig.cloud.projectId;
      appConfig.cloud.projectId = '77777777-7777-7777-7777-777777777777';
      delete process.env.AWS_INSTANCE_PROFILE_NAME;
    });

    afterEach(() => {
      appConfig.cloud.projectId = savedProjectId;
    });

    it('needs the infrastructure marker as well as a project id', () => {
      expect(isCloudProject()).toBe(false);

      process.env.AWS_INSTANCE_PROFILE_NAME = 'EC2-role';
      expect(isCloudProject()).toBe(true);
    });

    it('is false on our infrastructure without a usable project id', () => {
      process.env.AWS_INSTANCE_PROFILE_NAME = 'EC2-role';

      appConfig.cloud.projectId = undefined;
      expect(isCloudProject()).toBe(false);

      appConfig.cloud.projectId = 'local';
      expect(isCloudProject()).toBe(false);
    });
  });
});
