import { beforeEach, describe, expect, it, vi } from 'vitest';

const postMock = vi.hoisted(() => vi.fn());

vi.mock('axios', () => ({
  default: {
    post: postMock,
  },
}));

import { WebhookSender } from '../../src/infra/realtime/webhook-sender.js';

describe('WebhookSender outbound URL policy', () => {
  beforeEach(() => {
    postMock.mockReset();
  });

  it('blocks private webhook destinations before making a request', async () => {
    const result = await new WebhookSender().sendToAll(['http://127.0.0.1:7130'], {
      messageId: '00000000-0000-0000-0000-000000000001',
      channel: 'orders',
      eventName: 'created',
      payload: { id: 'order-1' },
    });

    expect(result[0]).toMatchObject({
      success: false,
      error: 'private or reserved network address',
    });
    expect(postMock).not.toHaveBeenCalled();
  });

  it('uses bounded request options for public destinations', async () => {
    postMock.mockResolvedValue({ status: 204 });

    const result = await new WebhookSender().sendToAll(['https://8.8.8.8/hook'], {
      messageId: '00000000-0000-0000-0000-000000000001',
      channel: 'orders',
      eventName: 'created',
      payload: { id: 'order-1' },
    });

    expect(result[0].success).toBe(true);
    expect(postMock).toHaveBeenCalledWith(
      'https://8.8.8.8/hook',
      { id: 'order-1' },
      expect.objectContaining({
        maxRedirects: 0,
        maxContentLength: 1024 * 1024,
        maxBodyLength: 10 * 1024 * 1024,
      })
    );
  });
});
