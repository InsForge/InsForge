import { beforeEach, describe, expect, it, vi } from 'vitest';

const { mockClient, mockPool, mockGetByName } = vi.hoisted(() => ({
  mockClient: {
    query: vi.fn(),
    release: vi.fn(),
  },
  mockPool: {
    connect: vi.fn(),
  },
  mockGetByName: vi.fn(),
}));

vi.mock('../../src/infra/database/database.manager', () => ({
  DatabaseManager: {
    getInstance: () => ({
      getPool: () => mockPool,
    }),
  },
}));

vi.mock('../../src/services/realtime/realtime-channel.service', () => ({
  RealtimeChannelService: {
    getInstance: () => ({
      getByName: mockGetByName,
    }),
  },
}));

vi.mock('../../src/utils/logger', () => ({
  default: {
    debug: vi.fn(),
    error: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
  },
}));

import { RealtimeMessageService } from '../../src/services/realtime/realtime-message.service';

function getInsertCall() {
  const insertCall = mockClient.query.mock.calls.find(([sql]) =>
    /INSERT INTO realtime\.messages/i.test(String(sql))
  );
  expect(insertCall).toBeDefined();
  return insertCall!;
}

describe('RealtimeMessageService', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockClient.query.mockReset();
    mockClient.release.mockReset();
    mockPool.connect.mockResolvedValue(mockClient);
    mockGetByName.mockResolvedValue({ id: '11111111-1111-1111-1111-111111111111' });
    mockClient.query.mockResolvedValue({ rows: [], rowCount: 0 });
  });

  it('stores project admin websocket publishes as system messages without a UUID sender', async () => {
    const result = await RealtimeMessageService.getInstance().insertMessage(
      'chat:lobby',
      'message',
      { text: 'hello' },
      { id: 'api-key', role: 'project_admin' }
    );

    const insertCall = getInsertCall();
    expect(insertCall[1]).toEqual([
      'message',
      '11111111-1111-1111-1111-111111111111',
      'chat:lobby',
      JSON.stringify({ text: 'hello' }),
      'system',
      null,
    ]);
    expect(result?.senderId).toBeNull();
  });

  it('stores authenticated websocket publishes as user messages with their UUID sender', async () => {
    const userId = '22222222-2222-2222-2222-222222222222';

    const result = await RealtimeMessageService.getInstance().insertMessage(
      'chat:lobby',
      'message',
      { text: 'hello' },
      { id: userId, role: 'authenticated' }
    );

    const insertCall = getInsertCall();
    expect(insertCall[1]).toEqual([
      'message',
      '11111111-1111-1111-1111-111111111111',
      'chat:lobby',
      JSON.stringify({ text: 'hello' }),
      'user',
      userId,
    ]);
    expect(result?.senderId).toBe(userId);
  });
});
