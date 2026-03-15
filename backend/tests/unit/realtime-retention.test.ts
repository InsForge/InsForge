import { beforeEach, describe, expect, it, vi } from 'vitest';

const { mockPool } = vi.hoisted(() => ({
  mockPool: {
    query: vi.fn(),
  },
}));

vi.mock('../../src/infra/database/database.manager', () => ({
  DatabaseManager: {
    getInstance: () => ({
      getPool: () => mockPool,
    }),
  },
}));

vi.mock('../../src/utils/logger', () => ({
  default: {
    info: vi.fn(),
    error: vi.fn(),
    warn: vi.fn(),
    debug: vi.fn(),
  },
}));

import { RealtimeMessageService } from '../../src/services/realtime/realtime-message.service';

describe('RealtimeMessageService - Retention', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('cleanupMessages', () => {
    it('calls SQL function with batch size', async () => {
      mockPool.query.mockResolvedValueOnce({ rows: [{ deletedCount: 5 }] });

      const service = RealtimeMessageService.getInstance();
      const count = await service.cleanupMessages(100);

      expect(count).toBe(5);
      expect(mockPool.query).toHaveBeenCalledWith(
        'SELECT realtime.cleanup_messages($1) as "deletedCount"',
        [100]
      );
    });

    it('returns 0 if result is empty', async () => {
      mockPool.query.mockResolvedValueOnce({ rows: [] });

      const service = RealtimeMessageService.getInstance();
      const count = await service.cleanupMessages(100);

      expect(count).toBe(0);
    });
  });

  describe('getStats', () => {
    it('includes retentionDays from _config', async () => {
      mockPool.query
        .mockResolvedValueOnce({
          rows: [{ total_messages: '10', wh_audience_total: '2', wh_delivered_total: '2' }],
        }) // statsResult
        .mockResolvedValueOnce({ rows: [] }) // topEventsResult
        .mockResolvedValueOnce({ rows: [{ value: '45' }] }); // configResult

      const service = RealtimeMessageService.getInstance();
      const stats = await service.getStats();

      expect(stats.retentionDays).toBe(45);
      expect(mockPool.query).toHaveBeenCalledTimes(3);
    });

    it('defaults to 30 days if config is missing', async () => {
      mockPool.query
        .mockResolvedValueOnce({ rows: [{ total_messages: '10' }] })
        .mockResolvedValueOnce({ rows: [] })
        .mockResolvedValueOnce({ rows: [] });

      const service = RealtimeMessageService.getInstance();
      const stats = await service.getStats();

      expect(stats.retentionDays).toBe(30);
    });
  });
});
