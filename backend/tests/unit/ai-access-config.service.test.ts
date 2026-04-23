import { beforeEach, describe, expect, it, vi } from 'vitest';

// ---------------------------------------------------------------------------
// Hoisted mocks for the database pool and logger.
// These are the ONLY vi.mock() calls in this file, so there is no conflict
// with the real AIAccessConfigService import below.
// ---------------------------------------------------------------------------
const { mockPool, mockConnect } = vi.hoisted(() => {
  const mockClient = {
    query: vi.fn(),
    release: vi.fn(),
  };
  const mockPool = {
    query: vi.fn(),
    connect: vi.fn().mockResolvedValue(mockClient),
  };
  return { mockPool, mockConnect: mockClient };
});

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

// Real implementation — receives the mockPool-wired DatabaseManager above.
import { AIAccessConfigService } from '../../src/services/ai/ai-access-config.service';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
function makeConfigRow(allowAnonAiAccess: boolean) {
  return {
    id: '11111111-1111-1111-1111-111111111111',
    allowAnonAiAccess,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------
describe('AIAccessConfigService', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Reset singleton so each test starts with a fresh instance.
    // @ts-expect-error — accessing private static for test isolation
    AIAccessConfigService.instance = undefined;
  });

  // -------------------------------------------------------------------------
  describe('getAIAccessConfig', () => {
    it('returns the row from the database when one exists', async () => {
      const row = makeConfigRow(true);
      mockPool.query.mockResolvedValueOnce({ rows: [row] });

      const service = AIAccessConfigService.getInstance();
      const result = await service.getAIAccessConfig();

      expect(result).toEqual(row);
      expect(mockPool.query).toHaveBeenCalledOnce();
    });

    it('returns default fallback (allowAnonAiAccess = true) when the table is empty', async () => {
      mockPool.query.mockResolvedValueOnce({ rows: [] });

      const service = AIAccessConfigService.getInstance();
      const result = await service.getAIAccessConfig();

      expect(result.allowAnonAiAccess).toBe(true);
      expect(result.id).toBe('00000000-0000-0000-0000-000000000000');
    });

    it('returns default fallback when the query throws', async () => {
      mockPool.query.mockRejectedValueOnce(new Error('DB down'));

      const service = AIAccessConfigService.getInstance();
      const result = await service.getAIAccessConfig();

      expect(result.allowAnonAiAccess).toBe(true);
    });
  });

  // -------------------------------------------------------------------------
  describe('isAnonAiAccessAllowed', () => {
    it('returns true when allow_anon_ai_access is enabled', async () => {
      mockPool.query.mockResolvedValueOnce({ rows: [makeConfigRow(true)] });

      const service = AIAccessConfigService.getInstance();
      const allowed = await service.isAnonAiAccessAllowed();

      expect(allowed).toBe(true);
    });

    it('returns false when allow_anon_ai_access is disabled', async () => {
      mockPool.query.mockResolvedValueOnce({ rows: [makeConfigRow(false)] });

      const service = AIAccessConfigService.getInstance();
      const allowed = await service.isAnonAiAccessAllowed();

      expect(allowed).toBe(false);
    });

    it('propagates DB errors — fails closed, caller decides how to deny', async () => {
      const dbErr = new Error('DB unreachable');
      mockPool.query.mockRejectedValueOnce(dbErr);

      const service = AIAccessConfigService.getInstance();

      await expect(service.isAnonAiAccessAllowed()).rejects.toThrow('DB unreachable');
    });

    it('returns true when the table is empty (matches column default and migration seed)', async () => {
      mockPool.query.mockResolvedValueOnce({ rows: [] });

      const service = AIAccessConfigService.getInstance();
      const allowed = await service.isAnonAiAccessAllowed();

      expect(allowed).toBe(true);
    });
  });

  // -------------------------------------------------------------------------
  describe('updateAIAccessConfig', () => {
    it('updates the existing singleton row and returns the updated config', async () => {
      const updatedRow = makeConfigRow(false);
      // connect → BEGIN → SELECT FOR UPDATE (row exists) → UPDATE → COMMIT
      mockConnect.query
        .mockResolvedValueOnce(undefined) // BEGIN
        .mockResolvedValueOnce({ rows: [{ id: updatedRow.id }] }) // SELECT FOR UPDATE
        .mockResolvedValueOnce({ rows: [updatedRow] }) // UPDATE … RETURNING
        .mockResolvedValueOnce(undefined); // COMMIT

      const service = AIAccessConfigService.getInstance();
      const result = await service.updateAIAccessConfig({ allowAnonAiAccess: false });

      expect(result.allowAnonAiAccess).toBe(false);
      expect(mockConnect.query).toHaveBeenCalledTimes(4);
      expect(mockConnect.release).toHaveBeenCalledOnce();

      const [updateSql, updateParams] = mockConnect.query.mock.calls[2] as [string, unknown[]];
      expect(updateSql).toContain('UPDATE ai.config');
      expect(updateSql).toContain('WHERE id = $2');
      // First param: the new flag value; second param: the id from SELECT FOR UPDATE
      expect(updateParams).toEqual([false, updatedRow.id]);
    });

    it('inserts a new row when the singleton row is missing', async () => {
      const newRow = makeConfigRow(true);
      // connect → BEGIN → SELECT FOR UPDATE (empty) → INSERT → COMMIT
      mockConnect.query
        .mockResolvedValueOnce(undefined) // BEGIN
        .mockResolvedValueOnce({ rows: [] }) // SELECT FOR UPDATE — no row
        .mockResolvedValueOnce({ rows: [newRow] }) // INSERT … RETURNING
        .mockResolvedValueOnce(undefined); // COMMIT

      const service = AIAccessConfigService.getInstance();
      const result = await service.updateAIAccessConfig({ allowAnonAiAccess: true });

      expect(result.allowAnonAiAccess).toBe(true);
      const [insertSql, insertParams] = mockConnect.query.mock.calls[2] as [string, unknown[]];
      expect(insertSql).toContain('INSERT INTO ai.config');
      // Only one parameter for INSERT — the flag value; no id needed
      expect(insertParams).toEqual([true]);
    });

    it('rolls back and throws AppError on database failure', async () => {
      mockConnect.query
        .mockResolvedValueOnce(undefined) // BEGIN
        .mockRejectedValueOnce(new Error('constraint violation')); // SELECT FOR UPDATE fails

      const service = AIAccessConfigService.getInstance();

      await expect(service.updateAIAccessConfig({ allowAnonAiAccess: false })).rejects.toThrow(
        'Failed to update AI access configuration'
      );

      // release() must be called even after an error
      expect(mockConnect.release).toHaveBeenCalledOnce();
    });
  });
});
