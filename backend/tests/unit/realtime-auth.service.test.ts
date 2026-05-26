import { beforeEach, describe, expect, it, vi } from 'vitest';

const { mockClient, mockPool } = vi.hoisted(() => ({
  mockClient: {
    query: vi.fn(),
    release: vi.fn(),
  },
  mockPool: {
    connect: vi.fn(),
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
    debug: vi.fn(),
    error: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
  },
}));

import { RealtimeAuthService } from '../../src/services/realtime/realtime-auth.service';

describe('RealtimeAuthService', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockClient.query.mockReset();
    mockClient.release.mockReset();
    mockPool.connect.mockResolvedValue(mockClient);
  });

  it('checks subscribe permission through the shared database context helper', async () => {
    mockClient.query.mockImplementation(async (sql: string) => {
      if (/SELECT 1 FROM realtime\.channels/i.test(sql)) {
        return { rows: [{ '?column?': 1 }], rowCount: 1 };
      }

      return { rows: [], rowCount: 0 };
    });

    const allowed = await RealtimeAuthService.getInstance().checkSubscribePermission('chat:lobby', {
      id: 'user-1',
      email: 'user@example.com',
      role: 'authenticated',
    });

    expect(allowed).toBe(true);
    expect(mockClient.query.mock.calls.map(([sql]) => sql)).toEqual([
      'BEGIN',
      'SET LOCAL ROLE authenticated',
      'SELECT set_config($1, $2, true)',
      'SELECT set_config($1, $2, true)',
      expect.stringMatching(/SELECT 1 FROM realtime\.channels/i),
      'COMMIT',
      'RESET ROLE',
    ]);
    const claimsConfigCall = mockClient.query.mock.calls[2];
    expect(claimsConfigCall).toEqual([
      'SELECT set_config($1, $2, true)',
      ['request.jwt.claims', expect.any(String)],
    ]);
    const claimsConfigParams = claimsConfigCall[1] as [string, string];
    expect(JSON.parse(claimsConfigParams[1])).toEqual({
      role: 'authenticated',
      sub: 'user-1',
      email: 'user@example.com',
    });
    expect(mockClient.query.mock.calls[3]).toEqual([
      'SELECT set_config($1, $2, true)',
      ['realtime.channel_name', 'chat:lobby'],
    ]);
    expect(mockClient.release).toHaveBeenCalledOnce();
  });
});
