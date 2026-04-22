import { describe, it, expect, beforeEach, vi } from 'vitest';
import { S3AccessKeyService } from '@/services/storage/s3-access-key.service.js';
import { EncryptionManager } from '@/infra/security/encryption.manager.js';

function mockPool(rows: unknown[] = [], count = 0) {
  return {
    query: vi.fn(async (sql: string) => {
      if (sql.toLowerCase().includes('count(*)')) {
        return { rows: [{ count }], rowCount: 1 };
      }
      if (sql.trim().startsWith('INSERT')) {
        return {
          rows: [
            {
              id: '11111111-1111-1111-1111-111111111111',
              access_key_id: 'INSFAAAAAAAAAAAAAAAA',
              description: null,
              created_at: new Date('2026-04-22T00:00:00Z'),
              last_used_at: null,
            },
          ],
          rowCount: 1,
        };
      }
      return { rows, rowCount: rows.length };
    }),
  } as unknown as import('pg').Pool;
}

describe('S3AccessKeyService', () => {
  beforeEach(() => {
    process.env.ENCRYPTION_KEY = 'a'.repeat(64);
  });

  it('generates access key id matching INSF + 16 uppercase alphanum', () => {
    const svc = new S3AccessKeyService(mockPool());
    const ak = (svc as unknown as { generateAccessKeyId: () => string }).generateAccessKeyId();
    expect(ak).toMatch(/^INSF[A-Z0-9]{16}$/);
    expect(ak).toHaveLength(20);
  });

  it('generates 40-char base64url secret', () => {
    const svc = new S3AccessKeyService(mockPool());
    const sk = (svc as unknown as { generateSecretAccessKey: () => string }).generateSecretAccessKey();
    expect(sk).toHaveLength(40);
    expect(sk).toMatch(/^[A-Za-z0-9_-]{40}$/);
  });

  it('encrypts secret before persisting', async () => {
    const pool = mockPool([], 0);
    const svc = new S3AccessKeyService(pool);
    const encryptSpy = vi.spyOn(EncryptionManager, 'encrypt');
    await svc.create({ description: 'test' });
    expect(encryptSpy).toHaveBeenCalledOnce();
    const insertCall = (pool.query as unknown as { mock: { calls: unknown[][] } }).mock.calls.find(
      (c) => typeof c[0] === 'string' && (c[0] as string).includes('INSERT')
    );
    expect(insertCall).toBeTruthy();
  });

  it('rejects creation when at 50-key cap', async () => {
    const pool = mockPool([], 50);
    const svc = new S3AccessKeyService(pool);
    await expect(svc.create({})).rejects.toThrow(/limit/i);
  });

  it('returns plaintext secret only in create response', async () => {
    const svc = new S3AccessKeyService(mockPool());
    const result = await svc.create({ description: 'test' });
    expect(result.secretAccessKey).toBeDefined();
    expect(result.secretAccessKey).toHaveLength(40);
  });
});
