import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  post: vi.fn(),
  sign: vi.fn(),
}));

vi.mock('axios', () => ({
  default: {
    post: mocks.post,
    isAxiosError: vi.fn().mockReturnValue(false),
  },
}));

vi.mock('jsonwebtoken', () => ({
  default: {
    sign: mocks.sign,
  },
}));

vi.mock('../../src/infra/config/app.config.js', () => ({
  appConfig: {
    app: { jwtSecret: 'jwt-secret' },
    cloud: {
      projectId: 'project-id',
      apiHost: 'https://api.insforge.dev',
    },
  },
}));

vi.mock('../../src/utils/logger.js', () => ({
  default: {
    info: vi.fn(),
    error: vi.fn(),
    warn: vi.fn(),
    debug: vi.fn(),
  },
}));

import { CloudEmailProvider } from '../../src/providers/email/cloud.provider.js';

describe('CloudEmailProvider request-otp support', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.sign.mockReturnValue('sign-token');
    mocks.post.mockResolvedValue({ data: { success: true } });
  });

  it('forwards the existing cloud request-otp template', async () => {
    const provider = new CloudEmailProvider();

    await provider.sendWithTemplate('user@example.com', 'User', 'request-otp', {
      token: '123456',
    });

    expect(mocks.post).toHaveBeenCalledWith(
      'https://api.insforge.dev/email/v1/project-id/send-with-template',
      {
        email: 'user@example.com',
        name: 'User',
        template: 'request-otp',
        variables: { token: '123456' },
      },
      expect.objectContaining({
        headers: expect.objectContaining({ sign: 'sign-token' }),
      })
    );
  });
});
