import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { mockQuery, mockPool } = vi.hoisted(() => {
  const query = vi.fn();
  const pool = {
    query,
  };
  return { mockQuery: query, mockPool: pool };
});

vi.mock('@/infra/database/database.manager.js', () => ({
  DatabaseManager: {
    getInstance: () => ({
      getPool: () => mockPool,
    }),
  },
}));

import { AppError } from '../../src/utils/errors';
import { AIUsageService } from '../../src/services/ai/ai-usage.service';

const TEST_USER_ID = '00000000-0000-0000-0000-000000000001';

describe('AIUsageService', () => {
  let service: AIUsageService;

  beforeEach(() => {
    vi.resetModules();
    mockQuery.mockReset();
    service = AIUsageService.getInstance();
  });

  afterEach(() => {
    mockQuery.mockReset();
  });

  describe('checkQuota', () => {
    it('allows request when no quota config exists', async () => {
      mockQuery.mockResolvedValue({ rows: [] });

      await expect(service.checkQuota(TEST_USER_ID, 'openai/gpt-4')).resolves.toBeUndefined();

      expect(mockQuery).toHaveBeenCalledTimes(1);
    });

    it('allows request when quota config has no limits', async () => {
      mockQuery.mockResolvedValue({
        rows: [
          {
            id: 'cfg-1',
            user_id: null,
            max_requests_per_day: null,
            max_tokens_per_day: null,
            max_tokens_per_month: null,
            monthly_spend_cap_usd: null,
            model_allowlist: null,
            updated_at: '2025-01-01T00:00:00Z',
          },
        ],
      });

      await expect(service.checkQuota(TEST_USER_ID, 'openai/gpt-4')).resolves.toBeUndefined();
    });

    it('blocks request for model not in allowlist', async () => {
      mockQuery.mockResolvedValue({
        rows: [
          {
            id: 'cfg-1',
            user_id: null,
            max_requests_per_day: null,
            max_tokens_per_day: null,
            max_tokens_per_month: null,
            monthly_spend_cap_usd: null,
            model_allowlist: ['openai/gpt-4o', 'anthropic/claude-3'],
            updated_at: '2025-01-01T00:00:00Z',
          },
        ],
      });

      await expect(service.checkQuota(TEST_USER_ID, 'openai/gpt-4')).rejects.toThrow(AppError);
      await expect(service.checkQuota(TEST_USER_ID, 'openai/gpt-4')).rejects.toMatchObject({
        code: 'AI_MODEL_NOT_ALLOWED',
        statusCode: 403,
      });
    });

    it('allows request for model in allowlist', async () => {
      mockQuery.mockResolvedValue({
        rows: [
          {
            id: 'cfg-1',
            user_id: null,
            max_requests_per_day: null,
            max_tokens_per_day: null,
            max_tokens_per_month: null,
            monthly_spend_cap_usd: null,
            model_allowlist: ['openai/gpt-4o'],
            updated_at: '2025-01-01T00:00:00Z',
          },
        ],
      });

      await expect(service.checkQuota(TEST_USER_ID, 'openai/gpt-4o')).resolves.toBeUndefined();
    });

    it('blocks request when daily request limit exceeded', async () => {
      mockQuery
        .mockResolvedValueOnce({
          rows: [
            {
              id: 'cfg-1',
              user_id: null,
              max_requests_per_day: 10,
              max_tokens_per_day: null,
              max_tokens_per_month: null,
              monthly_spend_cap_usd: null,
              model_allowlist: null,
              updated_at: '2025-01-01T00:00:00Z',
            },
          ],
        })
        .mockResolvedValueOnce({ rows: [{ cnt: 10 }] });

      await expect(service.checkQuota(TEST_USER_ID, 'openai/gpt-4')).rejects.toMatchObject({
        code: 'AI_QUOTA_EXCEEDED',
        statusCode: 429,
      });
    });

    it('blocks request when daily token limit exceeded', async () => {
      mockQuery
        .mockResolvedValueOnce({
          rows: [
            {
              id: 'cfg-1',
              user_id: null,
              max_requests_per_day: null,
              max_tokens_per_day: 10000,
              max_tokens_per_month: null,
              monthly_spend_cap_usd: null,
              model_allowlist: null,
              updated_at: '2025-01-01T00:00:00Z',
            },
          ],
        })
        .mockResolvedValueOnce({ rows: [{ total: 10000 }] });

      await expect(service.checkQuota(TEST_USER_ID, 'openai/gpt-4')).rejects.toThrow(AppError);
    });

    it('blocks request when monthly token limit exceeded', async () => {
      mockQuery
        .mockResolvedValueOnce({
          rows: [
            {
              id: 'cfg-1',
              user_id: null,
              max_requests_per_day: null,
              max_tokens_per_day: null,
              max_tokens_per_month: 500000,
              monthly_spend_cap_usd: null,
              model_allowlist: null,
              updated_at: '2025-01-01T00:00:00Z',
            },
          ],
        })
        .mockResolvedValueOnce({ rows: [{ total: 500000 }] });

      await expect(service.checkQuota(TEST_USER_ID, 'openai/gpt-4')).rejects.toThrow(AppError);
    });

    it('blocks request when monthly spend cap exceeded', async () => {
      mockQuery
        .mockResolvedValueOnce({
          rows: [
            {
              id: 'cfg-1',
              user_id: null,
              max_requests_per_day: null,
              max_tokens_per_day: null,
              max_tokens_per_month: null,
              monthly_spend_cap_usd: 50.0,
              model_allowlist: null,
              updated_at: '2025-01-01T00:00:00Z',
            },
          ],
        })
        .mockResolvedValueOnce({ rows: [{ total: '60.00' }] });

      await expect(service.checkQuota(TEST_USER_ID, 'openai/gpt-4')).rejects.toThrow(AppError);
    });

    it('allows request when usage is under all limits', async () => {
      mockQuery
        .mockResolvedValueOnce({
          rows: [
            {
              id: 'cfg-1',
              user_id: null,
              max_requests_per_day: 100,
              max_tokens_per_day: 100000,
              max_tokens_per_month: 1000000,
              monthly_spend_cap_usd: 100.0,
              model_allowlist: null,
              updated_at: '2025-01-01T00:00:00Z',
            },
          ],
        })
        .mockResolvedValueOnce({ rows: [{ cnt: 5 }] })
        .mockResolvedValueOnce({ rows: [{ total: 10000 }] })
        .mockResolvedValueOnce({ rows: [{ total: 50000 }] })
        .mockResolvedValueOnce({ rows: [{ total: '10.00' }] });

      await expect(service.checkQuota(TEST_USER_ID, 'openai/gpt-4')).resolves.toBeUndefined();
    });
  });

  describe('getEffectiveQuotaConfig', () => {
    it('returns per-user config when it exists', async () => {
      const configRow = {
        id: 'cfg-user',
        user_id: TEST_USER_ID,
        max_requests_per_day: 50,
        max_tokens_per_day: null,
        max_tokens_per_month: null,
        monthly_spend_cap_usd: null,
        model_allowlist: null,
        updated_at: '2025-01-01T00:00:00Z',
      };
      mockQuery.mockResolvedValue({ rows: [configRow] });

      const config = await service.getEffectiveQuotaConfig(TEST_USER_ID);
      expect(config).toMatchObject({
        max_requests_per_day: 50,
        user_id: TEST_USER_ID,
      });
    });

    it('returns global default when no per-user config exists', async () => {
      const defaultRow = {
        id: 'cfg-default',
        user_id: null,
        max_requests_per_day: 100,
        max_tokens_per_day: null,
        max_tokens_per_month: null,
        monthly_spend_cap_usd: null,
        model_allowlist: null,
        updated_at: '2025-01-01T00:00:00Z',
      };
      mockQuery.mockResolvedValue({ rows: [defaultRow] });

      const config = await service.getEffectiveQuotaConfig(TEST_USER_ID);
      expect(config).toMatchObject({
        user_id: null,
        max_requests_per_day: 100,
      });
    });

    it('returns null when no config exists at all', async () => {
      mockQuery.mockResolvedValue({ rows: [] });

      const config = await service.getEffectiveQuotaConfig(TEST_USER_ID);
      expect(config).toBeNull();
    });
  });

  describe('logUsage', () => {
    it('inserts a usage log row', async () => {
      mockQuery.mockResolvedValue({ rows: [] });

      await service.logUsage(TEST_USER_ID, 'openai/gpt-4', 100, 50, 'chat', 0.001);

      expect(mockQuery).toHaveBeenCalledWith(expect.stringContaining('INSERT INTO ai.usage_log'), [
        TEST_USER_ID,
        'openai/gpt-4',
        100,
        50,
        0.001,
        'chat',
      ]);
    });

    it('does not throw when insert fails', async () => {
      mockQuery.mockRejectedValue(new Error('DB connection lost'));

      await expect(
        service.logUsage(TEST_USER_ID, 'openai/gpt-4', 100, 50, 'chat')
      ).resolves.toBeUndefined();
    });
  });

  describe('getUserUsage', () => {
    it('returns aggregated usage for a user', async () => {
      mockQuery.mockResolvedValue({
        rows: [
          {
            prompt_tokens: 1000,
            completion_tokens: 500,
            total_tokens: 1500,
            estimated_cost: '0.005',
            request_count: 10,
          },
        ],
      });

      const usage = await service.getUserUsage(TEST_USER_ID, 'day');
      expect(usage.prompt_tokens).toBe(1000);
      expect(usage.completion_tokens).toBe(500);
      expect(usage.total_tokens).toBe(1500);
      expect(usage.request_count).toBe(10);
    });
  });

  describe('getUsageReport', () => {
    it('returns aggregated report with entries and totals', async () => {
      mockQuery
        .mockResolvedValueOnce({
          rows: [
            {
              user_id: TEST_USER_ID,
              model: 'openai/gpt-4',
              prompt_tokens: 500,
              completion_tokens: 300,
              total_tokens: 800,
              estimated_cost: '0.002',
              request_count: 5,
            },
          ],
        })
        .mockResolvedValueOnce({
          rows: [
            {
              prompt_tokens: 500,
              completion_tokens: 300,
              total_tokens: 800,
              estimated_cost: '0.002',
              request_count: 5,
            },
          ],
        });

      const report = await service.getUsageReport('day', TEST_USER_ID);
      expect(report.entries).toHaveLength(1);
      expect(report.totals.request_count).toBe(5);
      expect(report.period).toBe('day');
    });
  });

  describe('upsertQuotaConfig', () => {
    it('creates a new quota config for a user', async () => {
      const configRow = {
        id: 'cfg-new',
        user_id: TEST_USER_ID,
        max_requests_per_day: 50,
        max_tokens_per_day: null,
        max_tokens_per_month: null,
        monthly_spend_cap_usd: null,
        model_allowlist: null,
        updated_at: '2025-01-01T00:00:00Z',
      };
      mockQuery.mockResolvedValue({ rows: [configRow] });

      const result = await service.upsertQuotaConfig(TEST_USER_ID, {
        maxRequestsPerDay: 50,
      });

      expect(result.max_requests_per_day).toBe(50);
    });
  });
});
