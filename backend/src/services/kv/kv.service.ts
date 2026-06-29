import { Pool, PoolClient } from 'pg';
import { DatabaseManager } from '@/infra/database/database.manager.js';
import { withUserContext } from '@/services/database/user-context.service.js';
import type { StoreActor } from '@/api/middlewares/store-actor.js';
import { AppError } from '@/utils/errors.js';
import logger from '@/utils/logger.js';
import { ERROR_CODES, type KvEntry, type KvVisibility } from '@insforge/shared-schemas';

// Butterbase-style default: every new key expires in 30 days unless told otherwise.
const DEFAULT_TTL_SECONDS = 60 * 60 * 24 * 30;
// Hard cap on a single value's serialized size. Keeps KV honest as a cache/
// config store rather than a blob store (use Storage for large payloads).
const MAX_VALUE_BYTES = 256 * 1024;
// project-global rows have NULL owner_id; collapse to this sentinel so a single
// COALESCE predicate addresses the right row in both the admin and user paths.
const OWNER_SENTINEL = '00000000-0000-0000-0000-000000000000';

type Queryable = Pool | PoolClient;

// API-key/admin callers manage the shared project-global store (RLS-bypassing
// pool); end users operate on their own rows through withUserContext + RLS.
export type KvActor = StoreActor;

interface EntryRow {
  value: unknown;
  visibility: KvVisibility;
  expires_at: Date | null;
  created_at: Date;
  updated_at: Date;
  // (xmax = 0) — true only for a genuine INSERT, false when ON CONFLICT updated.
  inserted?: boolean;
}

function toIso(value: Date | null): string | null {
  if (value === null) {
    return null;
  }
  return value instanceof Date ? value.toISOString() : String(value);
}

// For NOT NULL timestamp columns (created_at / updated_at).
function toIsoRequired(value: Date): string {
  return value instanceof Date ? value.toISOString() : String(value);
}

export class KvService {
  private static instance: KvService;
  private pool: Pool | null = null;

  private constructor() {}

  public static getInstance(): KvService {
    if (!KvService.instance) {
      KvService.instance = new KvService();
    }
    return KvService.instance;
  }

  private getPool(): Pool {
    if (!this.pool) {
      this.pool = DatabaseManager.getInstance().getPool();
    }
    return this.pool;
  }

  // Resolve the actor to (a queryable, the owner_id to read/write). Admin uses
  // the superuser pool (RLS bypassed) and the project-global NULL owner. Users
  // run inside withUserContext so RLS applies; only authenticated users own
  // rows (anon/admin JWTs map to the NULL project-global owner).
  private async run<T>(
    actor: KvActor,
    fn: (db: Queryable, ownerId: string | null) => Promise<T>
  ): Promise<T> {
    if (actor.mode === 'admin') {
      return fn(this.getPool(), null);
    }
    const ctx = actor.ctx;
    const ownerId = ctx.role === 'authenticated' ? ctx.id : null;
    return withUserContext(this.getPool(), ctx, (client) => fn(client, ownerId));
  }

  private assertValueSize(value: unknown): string {
    const serialized = JSON.stringify(value ?? null);
    if (Buffer.byteLength(serialized, 'utf8') > MAX_VALUE_BYTES) {
      throw new AppError(
        `Value exceeds the ${MAX_VALUE_BYTES}-byte limit`,
        413,
        ERROR_CODES.KV_VALUE_TOO_LARGE
      );
    }
    return serialized;
  }

  // undefined ttl -> default; null -> no expiry; number -> seconds from now.
  private resolveTtl(ttl: number | null | undefined): number | null {
    if (ttl === undefined) {
      return DEFAULT_TTL_SECONDS;
    }
    return ttl;
  }

  async get(actor: KvActor, namespace: string, key: string): Promise<unknown | null> {
    return this.run(actor, async (db, ownerId) => {
      const result = await db.query(
        `SELECT value FROM kv.entries
          WHERE namespace = $1 AND key = $2
            AND COALESCE(owner_id, $3::uuid) = COALESCE($4::uuid, $3::uuid)
            AND (expires_at IS NULL OR expires_at > NOW())`,
        [namespace, key, OWNER_SENTINEL, ownerId]
      );
      return result.rows.length ? (result.rows[0].value as unknown) : null;
    });
  }

  async set(
    actor: KvActor,
    namespace: string,
    key: string,
    opts: {
      // z.unknown() yields an optional property; undefined is normalized to null.
      value?: unknown;
      ttl?: number | null;
      visibility?: KvVisibility;
      ifNotExists?: boolean;
    }
  ): Promise<{ created: boolean; entry: KvEntry | null }> {
    const serialized = this.assertValueSize(opts.value);
    const ttlSeconds = this.resolveTtl(opts.ttl);
    const visibility = opts.visibility ?? 'private';

    return this.run(actor, async (db, ownerId) => {
      // ON CONFLICT DO NOTHING for set-if-not-exists; otherwise overwrite.
      const conflictClause = opts.ifNotExists
        ? 'DO NOTHING'
        : `DO UPDATE SET value = EXCLUDED.value,
                         visibility = EXCLUDED.visibility,
                         expires_at = EXCLUDED.expires_at`;
      const result = await db.query(
        `INSERT INTO kv.entries (namespace, key, value, owner_id, visibility, expires_at)
         VALUES (
           $1, $2, $3::jsonb, $4::uuid, $5,
           CASE WHEN $6::int IS NULL THEN NULL ELSE NOW() + make_interval(secs => $6::int) END
         )
         ON CONFLICT (namespace, key, COALESCE(owner_id, $7::uuid)) ${conflictClause}
         RETURNING value, visibility, expires_at, created_at, updated_at, (xmax = 0) AS inserted`,
        [namespace, key, serialized, ownerId, visibility, ttlSeconds, OWNER_SENTINEL]
      );

      if (!result.rows.length) {
        // ifNotExists (DO NOTHING) hit an existing row — nothing written.
        return { created: false, entry: null };
      }
      const row = result.rows[0] as EntryRow;
      return {
        // true only for a genuine insert; an upsert that updated reports false.
        created: row.inserted === true,
        entry: {
          namespace,
          key,
          value: row.value,
          visibility: row.visibility,
          expiresAt: toIso(row.expires_at),
          createdAt: toIsoRequired(row.created_at),
          updatedAt: toIsoRequired(row.updated_at),
        },
      };
    });
  }

  async del(actor: KvActor, namespace: string, key: string): Promise<boolean> {
    return this.run(actor, async (db, ownerId) => {
      const result = await db.query(
        `DELETE FROM kv.entries
          WHERE namespace = $1 AND key = $2
            AND COALESCE(owner_id, $3::uuid) = COALESCE($4::uuid, $3::uuid)
            AND (expires_at IS NULL OR expires_at > NOW())`,
        [namespace, key, OWNER_SENTINEL, ownerId]
      );
      // A logically-expired key reports deleted=false, matching get() returning null.
      return (result.rowCount ?? 0) > 0;
    });
  }

  async exists(actor: KvActor, namespace: string, key: string): Promise<boolean> {
    // SELECT 1 instead of get(): avoids fetching a potentially large value JSONB
    // just to test presence.
    return this.run(actor, (db, ownerId) => this.existsInTx(db, namespace, key, ownerId));
  }

  // Atomic increment. Initializes a missing key to `by`. Fails if the existing
  // value is not a JSON number.
  async incrBy(actor: KvActor, namespace: string, key: string, by: number): Promise<number> {
    return this.run(actor, async (db, ownerId) => {
      try {
        const result = await db.query(
          `INSERT INTO kv.entries (namespace, key, value, owner_id, visibility, expires_at)
           VALUES (
             $1, $2, to_jsonb($5::numeric), $4::uuid, 'private',
             NOW() + make_interval(secs => $6::int)
           )
           ON CONFLICT (namespace, key, COALESCE(owner_id, $3::uuid))
           DO UPDATE SET value = to_jsonb(
             COALESCE((kv.entries.value #>> '{}')::numeric, 0) + $5::numeric
           )
           RETURNING value`,
          [namespace, key, OWNER_SENTINEL, ownerId, by, DEFAULT_TTL_SECONDS]
        );
        return Number(result.rows[0].value);
      } catch (error) {
        // 22P02 invalid_text_representation: existing value wasn't numeric.
        if (
          typeof error === 'object' &&
          error !== null &&
          'code' in error &&
          error.code === '22P02'
        ) {
          throw new AppError(
            `Value at ${namespace}/${key} is not a number`,
            400,
            ERROR_CODES.KV_NOT_A_NUMBER
          );
        }
        throw error;
      }
    });
  }

  // Compare-and-swap. Throws KV_CAS_MISMATCH (409) if the current value differs,
  // KV_NOT_FOUND (404) if the key is absent/expired.
  async cas(
    actor: KvActor,
    namespace: string,
    key: string,
    expected: unknown,
    next: unknown
  ): Promise<KvEntry> {
    const serializedNext = this.assertValueSize(next);
    const serializedExpected = JSON.stringify(expected ?? null);

    return this.run(actor, async (db, ownerId) => {
      const updated = await db.query(
        `UPDATE kv.entries
            SET value = $5::jsonb
          WHERE namespace = $1 AND key = $2
            AND COALESCE(owner_id, $3::uuid) = COALESCE($4::uuid, $3::uuid)
            AND value = $6::jsonb
            AND (expires_at IS NULL OR expires_at > NOW())
        RETURNING value, visibility, expires_at, created_at, updated_at`,
        [namespace, key, OWNER_SENTINEL, ownerId, serializedNext, serializedExpected]
      );

      if (updated.rows.length) {
        const row = updated.rows[0] as EntryRow;
        return {
          namespace,
          key,
          value: row.value,
          visibility: row.visibility,
          expiresAt: toIso(row.expires_at),
          createdAt: toIsoRequired(row.created_at),
          updatedAt: toIsoRequired(row.updated_at),
        };
      }

      // No row updated: distinguish absent key from a value mismatch.
      const exists = await this.existsInTx(db, namespace, key, ownerId);
      if (!exists) {
        throw new AppError(`Key not found: ${namespace}/${key}`, 404, ERROR_CODES.KV_NOT_FOUND);
      }
      throw new AppError(
        `Compare-and-swap failed: current value does not match expected`,
        409,
        ERROR_CODES.KV_CAS_MISMATCH
      );
    });
  }

  private async existsInTx(
    db: Queryable,
    namespace: string,
    key: string,
    ownerId: string | null
  ): Promise<boolean> {
    const result = await db.query(
      `SELECT 1 FROM kv.entries
        WHERE namespace = $1 AND key = $2
          AND COALESCE(owner_id, $3::uuid) = COALESCE($4::uuid, $3::uuid)
          AND (expires_at IS NULL OR expires_at > NOW())`,
      [namespace, key, OWNER_SENTINEL, ownerId]
    );
    return result.rows.length > 0;
  }

  // Set/clear the TTL without changing the value. Returns false if absent.
  async expire(
    actor: KvActor,
    namespace: string,
    key: string,
    ttl: number | null
  ): Promise<boolean> {
    return this.run(actor, async (db, ownerId) => {
      const result = await db.query(
        `UPDATE kv.entries
            SET expires_at = CASE WHEN $5::int IS NULL THEN NULL
                                  ELSE NOW() + make_interval(secs => $5::int) END
          WHERE namespace = $1 AND key = $2
            AND COALESCE(owner_id, $3::uuid) = COALESCE($4::uuid, $3::uuid)
            AND (expires_at IS NULL OR expires_at > NOW())`,
        [namespace, key, OWNER_SENTINEL, ownerId, ttl]
      );
      return (result.rowCount ?? 0) > 0;
    });
  }

  // Remaining seconds until expiry; null if the key never expires. Throws 404
  // if the key is absent/expired.
  async ttl(actor: KvActor, namespace: string, key: string): Promise<number | null> {
    return this.run(actor, async (db, ownerId) => {
      const result = await db.query(
        `SELECT EXTRACT(EPOCH FROM (expires_at - NOW())) AS ttl
           FROM kv.entries
          WHERE namespace = $1 AND key = $2
            AND COALESCE(owner_id, $3::uuid) = COALESCE($4::uuid, $3::uuid)
            AND (expires_at IS NULL OR expires_at > NOW())`,
        [namespace, key, OWNER_SENTINEL, ownerId]
      );
      if (!result.rows.length) {
        throw new AppError(`Key not found: ${namespace}/${key}`, 404, ERROR_CODES.KV_NOT_FOUND);
      }
      const ttl = result.rows[0].ttl;
      return ttl === null ? null : Math.floor(Number(ttl));
    });
  }

  async mget(actor: KvActor, namespace: string, keys: string[]): Promise<Record<string, unknown>> {
    return this.run(actor, async (db, ownerId) => {
      const result = await db.query(
        `SELECT key, value FROM kv.entries
          WHERE namespace = $1 AND key = ANY($2::text[])
            AND COALESCE(owner_id, $3::uuid) = COALESCE($4::uuid, $3::uuid)
            AND (expires_at IS NULL OR expires_at > NOW())`,
        [namespace, keys, OWNER_SENTINEL, ownerId]
      );
      const values: Record<string, unknown> = {};
      for (const row of result.rows) {
        values[row.key] = row.value;
      }
      return values;
    });
  }

  async mset(
    actor: KvActor,
    namespace: string,
    entries: Record<string, unknown>,
    ttl?: number | null,
    visibility?: KvVisibility
  ): Promise<number> {
    const ttlSeconds = this.resolveTtl(ttl);
    const vis = visibility ?? 'private';
    const pairs = Object.entries(entries);
    for (const [, value] of pairs) {
      this.assertValueSize(value);
    }
    if (pairs.length === 0) {
      return 0;
    }

    return this.run(actor, async (db, ownerId) => {
      // One multi-row upsert so the whole batch is atomic: a failure on any key
      // rolls back the rest instead of leaving a partial write.
      const params: unknown[] = [ownerId, vis, ttlSeconds, OWNER_SENTINEL];
      const rows = pairs.map(([key, value]) => {
        const base = params.length;
        params.push(namespace, key, JSON.stringify(value ?? null));
        return `($${base + 1}, $${base + 2}, $${base + 3}::jsonb, $1::uuid, $2, CASE WHEN $3::int IS NULL THEN NULL ELSE NOW() + make_interval(secs => $3::int) END)`;
      });
      const result = await db.query(
        `INSERT INTO kv.entries (namespace, key, value, owner_id, visibility, expires_at)
         VALUES ${rows.join(', ')}
         ON CONFLICT (namespace, key, COALESCE(owner_id, $4::uuid))
         DO UPDATE SET value = EXCLUDED.value,
                       visibility = EXCLUDED.visibility,
                       expires_at = EXCLUDED.expires_at`,
        params
      );
      return result.rowCount ?? pairs.length;
    });
  }

  async list(
    actor: KvActor,
    namespace: string
  ): Promise<
    Array<{ key: string; visibility: KvVisibility; expiresAt: string | null; updatedAt: string }>
  > {
    return this.run(actor, async (db, ownerId) => {
      const result = await db.query(
        `SELECT key, visibility, expires_at, updated_at FROM kv.entries
          WHERE namespace = $1
            AND COALESCE(owner_id, $2::uuid) = COALESCE($3::uuid, $2::uuid)
            AND (expires_at IS NULL OR expires_at > NOW())
          ORDER BY key ASC`,
        [namespace, OWNER_SENTINEL, ownerId]
      );
      return result.rows.map((r) => ({
        key: r.key,
        visibility: r.visibility,
        expiresAt: toIso(r.expires_at),
        updatedAt: toIsoRequired(r.updated_at),
      }));
    });
  }

  // TTL sweep — deletes expired rows across the whole store. Runs as the admin
  // pool (RLS bypassed) so a scheduled job can reclaim every owner's stale keys.
  async cleanupExpired(): Promise<number> {
    const result = await this.getPool().query(
      `DELETE FROM kv.entries WHERE expires_at IS NOT NULL AND expires_at < NOW()`
    );
    const count = result.rowCount ?? 0;
    if (count > 0) {
      logger.info('KV expired entries swept', { count });
    }
    return count;
  }
}
