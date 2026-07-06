import { beforeEach, describe, expect, it, vi } from 'vitest';

const { mockClient, mockPool, mockGetByName, mockLogger } = vi.hoisted(() => ({
  mockClient: {
    query: vi.fn(),
    release: vi.fn(),
  },
  mockPool: {
    connect: vi.fn(),
    query: vi.fn(),
  },
  mockGetByName: vi.fn(),
  mockLogger: {
    debug: vi.fn(),
    error: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
  },
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
  default: mockLogger,
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
    mockPool.query.mockReset();
    mockLogger.debug.mockReset();
    mockLogger.info.mockReset();
    mockLogger.warn.mockReset();
    mockPool.connect.mockResolvedValue(mockClient);
    mockGetByName.mockResolvedValue({ id: '11111111-1111-1111-1111-111111111111' });
    mockClient.query.mockResolvedValue({ rows: [], rowCount: 0 });
    mockPool.query.mockResolvedValue({ rows: [], rowCount: 0 });
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

  it('clears every realtime message in batches and returns the deleted count', async () => {
    const cutoffTime = new Date('2026-06-15T00:00:00.000Z');
    mockPool.query
      .mockResolvedValueOnce({ rows: [{ cutoff_time: cutoffTime }], rowCount: 1 })
      .mockResolvedValueOnce({ rows: [{ deleted_count: 1000 }], rowCount: 1 })
      .mockResolvedValueOnce({ rows: [{ deleted_count: 42 }], rowCount: 1 });

    const deleted = await RealtimeMessageService.getInstance().clearAllMessages();

    expect(deleted).toBe(1042);
    expect(mockPool.query).toHaveBeenCalledTimes(3);
    expect(String(mockPool.query.mock.calls[0][0])).toContain('SELECT NOW()');
    expect(String(mockPool.query.mock.calls[1][0])).toContain('WHERE created_at <= $2');
    expect(String(mockPool.query.mock.calls[1][0])).toContain('LIMIT $1');
    expect(mockPool.query.mock.calls[1][1]).toEqual([1000, cutoffTime]);
    expect(mockLogger.info).toHaveBeenCalledWith('Realtime messages cleared', {
      deletedCount: 1042,
      batches: 2,
    });
  });

  it('returns zero when there are no realtime messages to clear', async () => {
    const cutoffTime = new Date('2026-06-15T00:00:00.000Z');
    mockPool.query
      .mockResolvedValueOnce({ rows: [{ cutoff_time: cutoffTime }], rowCount: 1 })
      .mockResolvedValueOnce({ rows: [{ deleted_count: 0 }], rowCount: 1 });

    const deleted = await RealtimeMessageService.getInstance().clearAllMessages();

    expect(deleted).toBe(0);
    expect(mockPool.query).toHaveBeenCalledTimes(2);
    expect(mockLogger.info).toHaveBeenCalledWith('Realtime messages cleared', {
      deletedCount: 0,
      batches: 0,
    });
  });

  it('skips clearing when the batch size is invalid', async () => {
    const deleted = await RealtimeMessageService.getInstance().clearAllMessages(0);

    expect(deleted).toBe(0);
    expect(mockPool.query).not.toHaveBeenCalled();
    expect(mockLogger.warn).toHaveBeenCalledWith('Invalid realtime message clear batch size', {
      batchSize: 0,
    });
  });
});
