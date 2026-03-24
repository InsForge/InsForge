import { beforeEach, describe, expect, it, vi } from 'vitest';

import { ERROR_CODES } from '../../src/types/error-constants';

type DeviceAuthorizationStatus =
  | 'pending_authorization'
  | 'authenticated'
  | 'approved'
  | 'denied'
  | 'expired'
  | 'consumed';

type DeviceAuthorizationRow = {
  id: string;
  device_code_hash: string;
  user_code_hash: string;
  status: DeviceAuthorizationStatus;
  expires_at: string;
  poll_interval_seconds: number;
  approved_by_user_id: string | null;
  consumed_at: string | null;
  client_context: Record<string, unknown> | null;
  created_at: string;
  updated_at: string;
};

const { mockPool } = vi.hoisted(() => ({
  mockPool: {
    query: vi.fn(),
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
    info: vi.fn(),
    error: vi.fn(),
    warn: vi.fn(),
    debug: vi.fn(),
  },
}));

import { DeviceAuthorizationService } from '../../src/services/auth/device-authorization.service';

function createRow(overrides: Partial<DeviceAuthorizationRow> = {}): DeviceAuthorizationRow {
  const now = new Date().toISOString();
  return {
    id: '11111111-1111-1111-1111-111111111111',
    device_code_hash: 'device-hash',
    user_code_hash: 'user-hash',
    status: 'pending_authorization',
    expires_at: now,
    poll_interval_seconds: 5,
    approved_by_user_id: null,
    consumed_at: null,
    client_context: null,
    created_at: now,
    updated_at: now,
    ...overrides,
  };
}

function createQueryHandler(rows: Map<string, DeviceAuthorizationRow>) {
  return async (sql: string, params: unknown[]) => {
    if (sql.startsWith('INSERT INTO auth.device_authorizations')) {
      const row = createRow({
        device_code_hash: String(params[0]),
        user_code_hash: String(params[1]),
        expires_at: String(params[2]),
        poll_interval_seconds: Number(params[3]),
        client_context: params[4] ? JSON.parse(String(params[4])) : null,
      });

      rows.set(row.user_code_hash, row);
      rows.set(row.device_code_hash, row);
      return { rows: [row], rowCount: 1 };
    }

    if (sql.includes("SET status = 'authenticated'")) {
      const row = rows.get(String(params[0]));
      if (
        !row ||
        row.status !== 'pending_authorization' ||
        new Date(row.expires_at).getTime() <= Date.now()
      ) {
        return { rows: [], rowCount: 0 };
      }

      row.status = 'authenticated';
      row.approved_by_user_id = String(params[1]);
      row.updated_at = new Date().toISOString();
      return { rows: [row], rowCount: 1 };
    }

    if (sql.includes("SET status = 'approved'")) {
      const row = rows.get(String(params[0]));
      if (
        !row ||
        !['pending_authorization', 'authenticated', 'approved'].includes(row.status) ||
        new Date(row.expires_at).getTime() <= Date.now()
      ) {
        return { rows: [], rowCount: 0 };
      }

      if (row.approved_by_user_id && row.approved_by_user_id !== String(params[1])) {
        return { rows: [], rowCount: 0 };
      }

      row.status = 'approved';
      row.approved_by_user_id = row.approved_by_user_id ?? String(params[1]);
      row.updated_at = new Date().toISOString();
      return { rows: [row], rowCount: 1 };
    }

    if (sql.includes("SET status = 'denied'")) {
      const row = rows.get(String(params[0]));
      if (
        !row ||
        !['pending_authorization', 'authenticated', 'approved', 'denied'].includes(row.status) ||
        new Date(row.expires_at).getTime() <= Date.now()
      ) {
        return { rows: [], rowCount: 0 };
      }

      if (row.approved_by_user_id && row.approved_by_user_id !== String(params[1])) {
        return { rows: [], rowCount: 0 };
      }

      row.status = 'denied';
      row.updated_at = new Date().toISOString();
      return { rows: [row], rowCount: 1 };
    }

    if (sql.includes("SET status = 'consumed'")) {
      const row = rows.get(String(params[0]));
      if (!row || row.status !== 'approved' || new Date(row.expires_at).getTime() <= Date.now()) {
        return { rows: [], rowCount: 0 };
      }

      row.status = 'consumed';
      row.consumed_at = new Date().toISOString();
      row.updated_at = new Date().toISOString();
      return { rows: [row], rowCount: 1 };
    }

    if (sql.includes("SET status = 'expired'")) {
      const row = Array.from(rows.values()).find((item) => item.id === String(params[0]));
      if (!row || ['expired', 'consumed'].includes(row.status)) {
        return { rows: [], rowCount: 0 };
      }

      row.status = 'expired';
      row.updated_at = new Date().toISOString();
      return { rows: [row], rowCount: 1 };
    }

    if (sql.includes('WHERE user_code_hash = $1')) {
      const row = rows.get(String(params[0]));
      return { rows: row ? [row] : [], rowCount: row ? 1 : 0 };
    }

    if (sql.includes('WHERE device_code_hash = $1')) {
      const row = rows.get(String(params[0]));
      return { rows: row ? [row] : [], rowCount: row ? 1 : 0 };
    }

    throw new Error(`Unexpected SQL: ${sql}`);
  };
}

function installQueryMock(rows: Map<string, DeviceAuthorizationRow>) {
  const handler = createQueryHandler(rows);
  mockPool.query.mockImplementation(handler);
}

function cloneRows(rows: Map<string, DeviceAuthorizationRow>): Map<string, DeviceAuthorizationRow> {
  const clonedRows = new Map<string, DeviceAuthorizationRow>();
  const seen = new WeakMap<DeviceAuthorizationRow, DeviceAuthorizationRow>();

  for (const [key, row] of rows.entries()) {
    let cloned = seen.get(row);
    if (!cloned) {
      cloned = { ...row, client_context: row.client_context ? { ...row.client_context } : null };
      seen.set(row, cloned);
    }
    clonedRows.set(key, cloned);
  }

  return clonedRows;
}

function restoreRows(
  target: Map<string, DeviceAuthorizationRow>,
  snapshot: Map<string, DeviceAuthorizationRow>
) {
  target.clear();
  for (const [key, row] of snapshot.entries()) {
    target.set(key, row);
  }
}

function installTransactionalQueryMock(rows: Map<string, DeviceAuthorizationRow>) {
  let snapshot: Map<string, DeviceAuthorizationRow> | null = null;
  const baseHandler = createQueryHandler(rows);

  const handler = async (sql: string, params: unknown[]) => {
    if (sql === 'BEGIN') {
      snapshot = cloneRows(rows);
      return { rows: [], rowCount: 0 };
    }

    if (sql === 'COMMIT') {
      snapshot = null;
      return { rows: [], rowCount: 0 };
    }

    if (sql === 'ROLLBACK') {
      if (snapshot) {
        restoreRows(rows, snapshot);
      }
      snapshot = null;
      return { rows: [], rowCount: 0 };
    }

    if (sql.includes('FOR UPDATE') && sql.includes('WHERE device_code_hash = $1')) {
      const row = rows.get(String(params[0]));
      return { rows: row ? [row] : [], rowCount: row ? 1 : 0 };
    }

    return baseHandler(sql, params);
  };

  mockPool.query.mockImplementation(handler);
  mockPool.connect.mockResolvedValue({
    query: handler,
    release: vi.fn(),
  });
}

function installLockSensitiveTransactionalQueryMock(rows: Map<string, DeviceAuthorizationRow>) {
  let snapshot: Map<string, DeviceAuthorizationRow> | null = null;
  const baseHandler = createQueryHandler(rows);

  const handler = async (sql: string, params: unknown[]) => {
    if (sql === 'BEGIN') {
      snapshot = cloneRows(rows);
      return { rows: [], rowCount: 0 };
    }

    if (sql === 'COMMIT') {
      snapshot = null;
      return { rows: [], rowCount: 0 };
    }

    if (sql === 'ROLLBACK') {
      if (snapshot) {
        restoreRows(rows, snapshot);
      }
      snapshot = null;
      return { rows: [], rowCount: 0 };
    }

    if (sql.includes("SET status = 'expired'")) {
      throw new Error('self-lock');
    }

    if (sql.includes('FOR UPDATE') && sql.includes('WHERE device_code_hash = $1')) {
      const row = rows.get(String(params[0]));
      return { rows: row ? [row] : [], rowCount: row ? 1 : 0 };
    }

    return baseHandler(sql, params);
  };

  mockPool.query.mockImplementation(handler);
  mockPool.connect.mockResolvedValue({
    query: handler,
    release: vi.fn(),
  });
}

describe('DeviceAuthorizationService', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('creates a pending authorization session', async () => {
    const rows = new Map<string, DeviceAuthorizationRow>();
    installQueryMock(rows);

    const service = DeviceAuthorizationService.getInstance();
    const session = await service.create({
      deviceName: 'my-vps',
      hostname: 'vps-01',
      platform: 'linux-x64',
    });

    expect(session.status).toBe('pending_authorization');
    expect(session.userCode).toMatch(/^[A-Z0-9]{4}-[A-Z0-9]{4}$/);
    expect(session.deviceCode).toHaveLength(64);
  });

  it('expires stale records before mutating them', async () => {
    const rows = new Map<string, DeviceAuthorizationRow>();
    installQueryMock(rows);

    const service = DeviceAuthorizationService.getInstance();
    const created = await service.create({});
    const storedRow = Array.from(rows.values())[0];
    expect(storedRow).toBeDefined();
    if (!storedRow) {
      throw new Error('Expected stored authorization row');
    }

    storedRow.expires_at = new Date(Date.now() - 60_000).toISOString();

    await expect(
      service.markAuthenticated(created.userCode, '22222222-2222-2222-2222-222222222222')
    ).rejects.toMatchObject({
      name: 'AppError',
      code: ERROR_CODES.AUTH_DEVICE_AUTHORIZATION_EXPIRED,
      statusCode: 410,
    });

    const updatedRow = rows.get(storedRow.user_code_hash);
    expect(updatedRow?.status).toBe('expired');
  });

  it('allows consuming an approved authorization only once', async () => {
    const rows = new Map<string, DeviceAuthorizationRow>();
    installQueryMock(rows);

    const service = DeviceAuthorizationService.getInstance();
    const created = await service.create({});
    await service.markAuthenticated(created.userCode, '22222222-2222-2222-2222-222222222222');
    await service.approve(created.userCode, '22222222-2222-2222-2222-222222222222');

    const consumed = await service.consumeApproved(created.deviceCode);

    expect(consumed.status).toBe('consumed');

    await expect(service.consumeApproved(created.deviceCode)).rejects.toMatchObject({
      name: 'AppError',
      code: ERROR_CODES.AUTH_DEVICE_AUTHORIZATION_CONSUMED,
      statusCode: 409,
    });
  });

  it('keeps approve idempotent and canonicalizes approved expiry', async () => {
    const rows = new Map<string, DeviceAuthorizationRow>();
    installQueryMock(rows);

    const service = DeviceAuthorizationService.getInstance();
    const created = await service.create({});

    await service.markAuthenticated(created.userCode, '22222222-2222-2222-2222-222222222222');
    const firstApproved = await service.approve(
      created.userCode,
      '22222222-2222-2222-2222-222222222222'
    );
    const secondApproved = await service.approve(
      created.userCode,
      '22222222-2222-2222-2222-222222222222'
    );

    expect(firstApproved.status).toBe('approved');
    expect(secondApproved.status).toBe('approved');
    expect(secondApproved.approvedByUserId).toBe('22222222-2222-2222-2222-222222222222');

    const storedRow = Array.from(rows.values())[0];
    expect(storedRow).toBeDefined();
    if (!storedRow) {
      throw new Error('Expected stored authorization row');
    }

    storedRow.expires_at = new Date(Date.now() - 60_000).toISOString();

    await expect(
      service.approve(created.userCode, '22222222-2222-2222-2222-222222222222')
    ).rejects.toMatchObject({
      name: 'AppError',
      code: ERROR_CODES.AUTH_DEVICE_AUTHORIZATION_EXPIRED,
      statusCode: 410,
    });

    expect(storedRow.status).toBe('expired');
  });

  it('keeps denied records denied even after they expire', async () => {
    const rows = new Map<string, DeviceAuthorizationRow>();
    installQueryMock(rows);

    const service = DeviceAuthorizationService.getInstance();
    const created = await service.create({});

    await service.deny(created.userCode);

    const storedRow = Array.from(rows.values())[0];
    expect(storedRow).toBeDefined();
    if (!storedRow) {
      throw new Error('Expected stored authorization row');
    }

    storedRow.expires_at = new Date(Date.now() - 60_000).toISOString();

    const found = await service.findByUserCode(created.userCode);
    expect(found?.status).toBe('denied');
    expect(storedRow.status).toBe('denied');

    await expect(service.consumeApproved(created.deviceCode)).rejects.toMatchObject({
      name: 'AppError',
      code: ERROR_CODES.AUTH_DEVICE_AUTHORIZATION_DENIED,
      statusCode: 403,
    });
    expect(storedRow.status).toBe('denied');
  });

  it('does not consume an approved authorization when minting fails before consumption', async () => {
    const rows = new Map<string, DeviceAuthorizationRow>();
    installTransactionalQueryMock(rows);

    const service = DeviceAuthorizationService.getInstance();
    const created = await service.create({});
    await service.markAuthenticated(created.userCode, '22222222-2222-2222-2222-222222222222');
    await service.approve(created.userCode, '22222222-2222-2222-2222-222222222222');

    await expect(
      service.exchangeApproved(created.deviceCode, async () => {
        throw new Error('mint failed');
      })
    ).rejects.toThrow('mint failed');

    const storedRow = Array.from(rows.values())[0];
    expect(storedRow).toBeDefined();
    if (!storedRow) {
      throw new Error('Expected stored authorization row');
    }

    expect(storedRow.status).toBe('approved');
    expect(storedRow.consumed_at).toBeNull();
  });

  it('returns expired_token instead of self-locking when the authorization expires during exchange', async () => {
    const rows = new Map<string, DeviceAuthorizationRow>();
    installLockSensitiveTransactionalQueryMock(rows);

    const service = DeviceAuthorizationService.getInstance();
    const created = await service.create({});
    await service.markAuthenticated(created.userCode, '22222222-2222-2222-2222-222222222222');
    await service.approve(created.userCode, '22222222-2222-2222-2222-222222222222');

    await expect(
      service.exchangeApproved(created.deviceCode, async () => {
        const storedRow = Array.from(rows.values())[0];
        if (!storedRow) {
          throw new Error('Expected stored authorization row');
        }

        storedRow.expires_at = new Date(Date.now() - 60_000).toISOString();
        return {
          accessToken: 'unused',
        };
      })
    ).rejects.toMatchObject({
      name: 'AppError',
      code: ERROR_CODES.AUTH_DEVICE_AUTHORIZATION_EXPIRED,
      statusCode: 410,
    });
  });

  it('rejects approve from a different authenticated user when already bound', async () => {
    const rows = new Map<string, DeviceAuthorizationRow>();
    installQueryMock(rows);

    const service = DeviceAuthorizationService.getInstance();
    const created = await service.create({});
    await service.markAuthenticated(created.userCode, '22222222-2222-2222-2222-222222222222');
    await service.approve(created.userCode, '22222222-2222-2222-2222-222222222222');

    await expect(
      service.approve(created.userCode, '33333333-3333-3333-3333-333333333333')
    ).rejects.toMatchObject({
      name: 'AppError',
      code: ERROR_CODES.FORBIDDEN,
      statusCode: 403,
    });
  });

  it('rejects deny from a different authenticated user when already bound', async () => {
    const rows = new Map<string, DeviceAuthorizationRow>();
    installQueryMock(rows);

    const service = DeviceAuthorizationService.getInstance();
    const created = await service.create({});
    await service.markAuthenticated(created.userCode, '22222222-2222-2222-2222-222222222222');
    await service.approve(created.userCode, '22222222-2222-2222-2222-222222222222');

    await expect(
      service.deny(created.userCode, '33333333-3333-3333-3333-333333333333')
    ).rejects.toMatchObject({
      name: 'AppError',
      code: ERROR_CODES.FORBIDDEN,
      statusCode: 403,
    });
  });
});
