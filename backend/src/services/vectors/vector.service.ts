import { Pool, PoolClient } from 'pg';
import { randomUUID } from 'crypto';
import { DatabaseManager } from '@/infra/database/database.manager.js';
import { EmbeddingService } from '@/services/ai/embedding.service.js';
import { withUserContext } from '@/services/database/user-context.service.js';
import type { StoreActor } from '@/api/middlewares/store-actor.js';
import { AppError } from '@/utils/errors.js';
import logger from '@/utils/logger.js';
import {
  ERROR_CODES,
  VECTOR_DEFAULT_DIMENSION,
  type VectorCollection,
  type VectorMatch,
  type VectorMetric,
  type VectorUpsertItem,
} from '@insforge/shared-schemas';

// Matches the column dimension in migration 059 and the managed embedding model.
const EMBED_MODEL = 'openai/text-embedding-3-small';
const EMBED_DIMENSIONS = VECTOR_DEFAULT_DIMENSION;
const OWNER_SENTINEL = '00000000-0000-0000-0000-000000000000';

type Queryable = Pool | PoolClient;

export type VectorActor = StoreActor;

interface CollectionRow {
  id: string;
  name: string;
  dimension: number;
  metric: VectorMetric;
  created_at: Date;
}

// pgvector accepts a bracketed float literal cast to ::vector.
function toVectorLiteral(vec: number[]): string {
  return `[${vec.join(',')}]`;
}

function toIso(value: Date): string {
  return value instanceof Date ? value.toISOString() : String(value);
}

export class VectorService {
  private static instance: VectorService;
  private pool: Pool | null = null;
  private embeddingService = EmbeddingService.getInstance();

  private constructor() {}

  public static getInstance(): VectorService {
    if (!VectorService.instance) {
      VectorService.instance = new VectorService();
    }
    return VectorService.instance;
  }

  private getPool(): Pool {
    if (!this.pool) {
      this.pool = DatabaseManager.getInstance().getPool();
    }
    return this.pool;
  }

  private async run<T>(
    actor: VectorActor,
    fn: (db: Queryable, ownerId: string | null) => Promise<T>
  ): Promise<T> {
    if (actor.mode === 'admin') {
      return fn(this.getPool(), null);
    }
    const ctx = actor.ctx;
    const ownerId = ctx.role === 'authenticated' ? ctx.id : null;
    return withUserContext(this.getPool(), ctx, (client) => fn(client, ownerId));
  }

  // ---- collections --------------------------------------------------------

  async createCollection(
    actor: VectorActor,
    input: { name: string; dimension: number; metric: VectorMetric }
  ): Promise<VectorCollection> {
    // MVP backs every collection with a single VECTOR(1536) column, so the
    // dimension is fixed. A future per-collection-table backend lifts this.
    if (input.dimension !== EMBED_DIMENSIONS) {
      throw new AppError(
        `Only ${EMBED_DIMENSIONS}-dimension collections are supported in this version`,
        400,
        ERROR_CODES.VECTOR_DIMENSION_MISMATCH
      );
    }

    return this.run(actor, async (db, ownerId) => {
      try {
        const result = await db.query(
          `INSERT INTO vectors.collections (name, dimension, metric, owner_id)
           VALUES ($1, $2, $3, $4::uuid)
           RETURNING id, name, dimension, metric, created_at`,
          [input.name, input.dimension, input.metric, ownerId]
        );
        const row = result.rows[0] as CollectionRow;
        return {
          id: row.id,
          name: row.name,
          dimension: row.dimension,
          metric: row.metric,
          createdAt: toIso(row.created_at),
        };
      } catch (error) {
        // 23505 unique_violation: a collection with this name already exists.
        if (
          typeof error === 'object' &&
          error !== null &&
          'code' in error &&
          error.code === '23505'
        ) {
          throw new AppError(
            `Collection already exists: ${input.name}`,
            409,
            ERROR_CODES.VECTOR_COLLECTION_ALREADY_EXISTS
          );
        }
        throw error;
      }
    });
  }

  async listCollections(actor: VectorActor): Promise<VectorCollection[]> {
    return this.run(actor, async (db, ownerId) => {
      const result = await db.query(
        `SELECT id, name, dimension, metric, created_at FROM vectors.collections
          WHERE COALESCE(owner_id, $1::uuid) = COALESCE($2::uuid, $1::uuid)
          ORDER BY created_at DESC`,
        [OWNER_SENTINEL, ownerId]
      );
      return result.rows.map((row: CollectionRow) => ({
        id: row.id,
        name: row.name,
        dimension: row.dimension,
        metric: row.metric,
        createdAt: toIso(row.created_at),
      }));
    });
  }

  async deleteCollection(actor: VectorActor, name: string): Promise<boolean> {
    return this.run(actor, async (db, ownerId) => {
      const result = await db.query(
        `DELETE FROM vectors.collections
          WHERE name = $1
            AND COALESCE(owner_id, $2::uuid) = COALESCE($3::uuid, $2::uuid)`,
        [name, OWNER_SENTINEL, ownerId]
      );
      return (result.rowCount ?? 0) > 0;
    });
  }

  private async resolveCollection(
    db: Queryable,
    name: string,
    ownerId: string | null
  ): Promise<CollectionRow> {
    const result = await db.query(
      `SELECT id, name, dimension, metric, created_at FROM vectors.collections
        WHERE name = $1
          AND COALESCE(owner_id, $2::uuid) = COALESCE($3::uuid, $2::uuid)`,
      [name, OWNER_SENTINEL, ownerId]
    );
    if (!result.rows.length) {
      throw new AppError(
        `Collection not found: ${name}`,
        404,
        ERROR_CODES.VECTOR_COLLECTION_NOT_FOUND
      );
    }
    return result.rows[0] as CollectionRow;
  }

  // ---- embeddings ---------------------------------------------------------

  private async embed(texts: string[]): Promise<number[][]> {
    const res = await this.embeddingService.createEmbeddings({
      model: EMBED_MODEL,
      input: texts,
      dimensions: EMBED_DIMENSIONS,
    });
    return res.data.map((d) => {
      if (!Array.isArray(d.embedding)) {
        throw new AppError(
          'Embedding provider returned no vector',
          502,
          ERROR_CODES.AI_UPSTREAM_UNAVAILABLE
        );
      }
      return d.embedding;
    });
  }

  // Resolve each item to a concrete embedding: bring-your-own vector (validated
  // against the collection dimension) or auto-embedded from `content`. Content
  // items are embedded in a single batched provider call.
  private async resolveEmbeddings(
    items: VectorUpsertItem[],
    dimension: number
  ): Promise<number[][]> {
    const toEmbedIndexes: number[] = [];
    const toEmbedTexts: string[] = [];
    const out: (number[] | null)[] = items.map((item) => {
      if (item.vector) {
        if (item.vector.length !== dimension) {
          throw new AppError(
            `Vector has ${item.vector.length} dimensions, expected ${dimension}`,
            400,
            ERROR_CODES.VECTOR_DIMENSION_MISMATCH
          );
        }
        return item.vector;
      }
      return null;
    });

    items.forEach((item, i) => {
      if (out[i] === null && item.content) {
        toEmbedIndexes.push(i);
        toEmbedTexts.push(item.content);
      }
    });

    if (toEmbedTexts.length) {
      const embeddings = await this.embed(toEmbedTexts);
      toEmbedIndexes.forEach((itemIndex, k) => {
        out[itemIndex] = embeddings[k];
      });
    }

    return out.map((vec, i) => {
      if (!vec) {
        throw new AppError(
          `Item ${i} has neither a vector nor content`,
          400,
          ERROR_CODES.VECTOR_QUERY_INVALID
        );
      }
      return vec;
    });
  }

  // ---- items --------------------------------------------------------------

  async upsert(
    actor: VectorActor,
    collectionName: string,
    items: VectorUpsertItem[]
  ): Promise<string[]> {
    // Resolve the collection under the actor's context (RLS) first, then embed
    // outside any DB transaction so the provider HTTP call never holds a
    // connection open.
    const collection = await this.run(actor, (db, ownerId) =>
      this.resolveCollection(db, collectionName, ownerId)
    );
    const embeddings = await this.resolveEmbeddings(items, collection.dimension);

    // Pre-generate ids so the returned order matches the input and an
    // explicit-id upsert is idempotent via ON CONFLICT (id) DO UPDATE.
    const ids = items.map((item) => item.id ?? randomUUID());

    return this.run(actor, async (db, ownerId) => {
      // Single multi-row upsert so the whole batch commits or rolls back together.
      const params: unknown[] = [collection.id, ownerId];
      const rows = items.map((item, i) => {
        const base = params.length;
        params.push(
          ids[i],
          toVectorLiteral(embeddings[i]),
          item.content ?? null,
          JSON.stringify(item.metadata ?? {})
        );
        return `($${base + 1}, $1, $${base + 2}::vector, $${base + 3}, $${base + 4}::jsonb, $2::uuid)`;
      });
      await db.query(
        `INSERT INTO vectors.items (id, collection_id, embedding, content, metadata, owner_id)
         VALUES ${rows.join(', ')}
         ON CONFLICT (id) DO UPDATE SET
           embedding = EXCLUDED.embedding,
           content = EXCLUDED.content,
           metadata = EXCLUDED.metadata`,
        params
      );
      return ids;
    });
  }

  async deleteItem(actor: VectorActor, collectionName: string, itemId: string): Promise<boolean> {
    return this.run(actor, async (db, ownerId) => {
      const collection = await this.resolveCollection(db, collectionName, ownerId);
      const result = await db.query(
        `DELETE FROM vectors.items
          WHERE id = $1 AND collection_id = $2
            AND COALESCE(owner_id, $3::uuid) = COALESCE($4::uuid, $3::uuid)`,
        [itemId, collection.id, OWNER_SENTINEL, ownerId]
      );
      return (result.rowCount ?? 0) > 0;
    });
  }

  // Distance operator + score expression per metric. Cosine is HNSW-indexed;
  // l2/ip are correct but sequential-scan in the MVP.
  private metricSql(metric: VectorMetric): { op: string; score: string } {
    switch (metric) {
      case 'l2':
        return { op: '<->', score: '-(embedding <-> $1::vector)' };
      case 'ip':
        return { op: '<#>', score: '-(embedding <#> $1::vector)' };
      case 'cosine':
      default:
        return { op: '<=>', score: '1 - (embedding <=> $1::vector)' };
    }
  }

  async query(
    actor: VectorActor,
    collectionName: string,
    params: {
      vector?: number[];
      text?: string;
      topK: number;
      filter?: Record<string, unknown>;
      includeContent: boolean;
    }
  ): Promise<VectorMatch[]> {
    return this.run(actor, async (db, ownerId) => {
      const collection = await this.resolveCollection(db, collectionName, ownerId);

      let vector = params.vector;
      if (!vector && params.text) {
        vector = (await this.embed([params.text]))[0];
      }
      if (!vector) {
        throw new AppError(
          'Provide either a vector or text to query',
          400,
          ERROR_CODES.VECTOR_QUERY_INVALID
        );
      }
      if (vector.length !== collection.dimension) {
        throw new AppError(
          `Query vector has ${vector.length} dimensions, expected ${collection.dimension}`,
          400,
          ERROR_CODES.VECTOR_DIMENSION_MISMATCH
        );
      }

      const { op, score } = this.metricSql(collection.metric);
      const literal = toVectorLiteral(vector);
      const args: unknown[] = [literal, collection.id];
      let filterClause = '';
      if (params.filter && Object.keys(params.filter).length > 0) {
        args.push(JSON.stringify(params.filter));
        filterClause = `AND metadata @> $${args.length}::jsonb`;
      }
      args.push(params.topK);
      const limitParam = `$${args.length}`;

      const result = await db.query(
        `SELECT id, ${params.includeContent ? 'content' : 'NULL AS content'}, metadata,
                ${score} AS score
           FROM vectors.items
          WHERE collection_id = $2 ${filterClause}
          ORDER BY embedding ${op} $1::vector
          LIMIT ${limitParam}`,
        args
      );

      return result.rows.map((row) => ({
        id: row.id,
        score: Number(row.score),
        content: row.content ?? null,
        metadata: (row.metadata as Record<string, unknown>) ?? {},
      }));
    });
  }

  // Best-effort warning if the AI gateway isn't configured for auto-embed.
  logEmbeddingDependency(): void {
    logger.debug('VectorService auto-embed uses the Model Gateway', { model: EMBED_MODEL });
  }
}
