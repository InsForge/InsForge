import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AppError } from '../../src/api/middlewares/error';

const { mockClient, mockPool } = vi.hoisted(() => ({
  mockClient: {
    query: vi.fn(),
    release: vi.fn(),
  },
  mockPool: {
    connect: vi.fn(),
  },
}));

vi.mock('../../src/infra/database/database.manager.js', () => ({
  DatabaseManager: {
    getInstance: () => ({
      getPool: () => mockPool,
    }),
  },
}));

const { mockLogger } = vi.hoisted(() => ({
  mockLogger: {
    info: vi.fn(),
    error: vi.fn(),
    warn: vi.fn(),
    debug: vi.fn(),
  },
}));

vi.mock('../../src/utils/logger.js', () => ({
  __esModule: true,
  default: mockLogger,
}));

import { DatabaseAdvanceService } from '../../src/services/database/database-advance.service';

describe('DatabaseAdvanceService - explainRawSQL', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockPool.connect.mockResolvedValue(mockClient);
    mockClient.query.mockReset();
    mockClient.release.mockReset();
  });

  it('wraps explain analyze in a rollback transaction and normalizes the plan', async () => {
    mockClient.query
      .mockResolvedValueOnce({}) // SET statement_timeout
      .mockResolvedValueOnce({}) // BEGIN
      .mockResolvedValueOnce({
        rows: [
          {
            'QUERY PLAN': [
              {
                Plan: {
                  'Node Type': 'Seq Scan',
                  'Startup Cost': 0,
                  'Total Cost': 18.1,
                  'Plan Rows': 4,
                  'Actual Startup Time': 0.015,
                  'Actual Total Time': 0.045,
                  'Actual Rows': 4,
                  'Actual Loops': 1,
                  'Relation Name': 'users',
                  Filter: '(email IS NOT NULL)',
                  Plans: [
                    {
                      'Node Type': 'Index Scan',
                      'Startup Cost': 0.14,
                      'Total Cost': 8.4,
                      'Plan Rows': 1,
                      'Actual Startup Time': 0.01,
                      'Actual Total Time': 0.02,
                      'Actual Rows': 1,
                      'Actual Loops': 1,
                      'Index Name': 'users_email_idx',
                    },
                  ],
                },
                'Planning Time': 0.22,
                'Execution Time': 0.61,
              },
            ],
          },
        ],
      })
      .mockResolvedValueOnce({}) // ROLLBACK
      .mockResolvedValueOnce({}); // reset statement_timeout

    const service = DatabaseAdvanceService.getInstance();
    const result = await service.explainRawSQL('SELECT * FROM users WHERE email IS NOT NULL');

    expect(mockClient.query).toHaveBeenNthCalledWith(1, 'SET statement_timeout = 30000');
    expect(mockClient.query).toHaveBeenNthCalledWith(2, 'BEGIN');
    expect(mockClient.query).toHaveBeenNthCalledWith(
      3,
      'EXPLAIN (FORMAT JSON, ANALYZE, BUFFERS) SELECT * FROM users WHERE email IS NOT NULL',
      []
    );
    expect(mockClient.query).toHaveBeenNthCalledWith(4, 'ROLLBACK');
    expect(mockClient.query).toHaveBeenNthCalledWith(5, 'SET statement_timeout = 0');
    expect(mockClient.release).toHaveBeenCalled();

    expect(result).toEqual({
      plan: {
        nodeType: 'Seq Scan',
        startupCost: 0,
        totalCost: 18.1,
        planRows: 4,
        actualStartupTime: 0.015,
        actualTotalTime: 0.045,
        actualRows: 4,
        actualLoops: 1,
        relationName: 'users',
        filter: '(email IS NOT NULL)',
        plans: [
          {
            nodeType: 'Index Scan',
            startupCost: 0.14,
            totalCost: 8.4,
            planRows: 1,
            actualStartupTime: 0.01,
            actualTotalTime: 0.02,
            actualRows: 1,
            actualLoops: 1,
            indexName: 'users_email_idx',
            plans: undefined,
          },
        ],
      },
      planningTime: 0.22,
      executionTime: 0.61,
      totalTime: 0.83,
    });
  });

  it('rejects multiple SQL statements', async () => {
    const service = DatabaseAdvanceService.getInstance();

    await expect(service.explainRawSQL('SELECT 1; SELECT 2')).rejects.toBeInstanceOf(AppError);
    await expect(service.explainRawSQL('SELECT 1; SELECT 2')).rejects.toMatchObject({
      message: 'Explain supports a single SQL statement at a time',
    });
    expect(mockPool.connect).not.toHaveBeenCalled();
  });

  it('rejects unsupported explain statements before hitting the database', async () => {
    const service = DatabaseAdvanceService.getInstance();

    await expect(service.explainRawSQL('CREATE TABLE demo (id int)')).rejects.toMatchObject({
      message: 'Explain supports SELECT, INSERT, UPDATE, DELETE, MERGE, and VALUES statements only',
    });
    expect(mockPool.connect).not.toHaveBeenCalled();
  });
});
