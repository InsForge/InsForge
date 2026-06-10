import { DatabaseManager } from '@/infra/database/database.manager.js';
import { EmbeddingService } from '@/services/ai/embedding.service.js';
import { ChatCompletionService } from '@/services/ai/chat-completion.service.js';
import { AppError } from '@/utils/errors.js';
import logger from '@/utils/logger.js';
import {
  ERROR_CODES,
  type MemoryKind,
  type RememberResult,
  type RecalledMemory,
} from '@insforge/shared-schemas';

const EMBED_MODEL = 'openai/text-embedding-3-small';
const EMBED_DIMENSIONS = 1536;
const CHAT_MODEL = 'openai/gpt-4o-mini';

// Tuned via offline eval (F1=0.96 at 0.45 vs 0.68 at 0.35 for text-embedding-3-small).
const DEFAULT_RECALL_THRESHOLD = 0.45;
// Tighter — only near-duplicates should trigger the reconcile LLM call.
const RECONCILE_THRESHOLD = 0.5;

interface Candidate {
  kind: MemoryKind;
  title: string;
  content: string;
}

interface SimilarRow {
  id: string;
  kind: MemoryKind;
  title: string;
  content: string;
  similarity: number;
}

export class MemoryService {
  private static instance: MemoryService;
  private dbManager = DatabaseManager.getInstance();
  private embeddingService = EmbeddingService.getInstance();
  private chatService = ChatCompletionService.getInstance();

  private constructor() {}

  public static getInstance(): MemoryService {
    if (!MemoryService.instance) {
      MemoryService.instance = new MemoryService();
    }
    return MemoryService.instance;
  }

  // ---- helpers ------------------------------------------------------------

  private async embed(text: string): Promise<number[]> {
    const res = await this.embeddingService.createEmbeddings({
      model: EMBED_MODEL,
      input: text,
      dimensions: EMBED_DIMENSIONS,
    });
    const vec = res.data[0]?.embedding;
    if (!Array.isArray(vec)) {
      throw new AppError('Embedding provider returned no vector', 502, ERROR_CODES.AI_UPSTREAM_UNAVAILABLE);
    }
    return vec;
  }

  // pgvector accepts a bracketed float literal cast to ::vector
  private toVectorLiteral(vec: number[]): string {
    return `[${vec.join(',')}]`;
  }

  // The chat models are not in JSON mode; parse defensively.
  private parseJSON<T>(text: string): T | null {
    try {
      const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/);
      const raw = fenced ? fenced[1] : text;
      const start = raw.indexOf('{');
      const end = raw.lastIndexOf('}');
      if (start === -1 || end === -1) return null;
      return JSON.parse(raw.slice(start, end + 1)) as T;
    } catch {
      return null;
    }
  }

  private async chatJSON<T>(system: string, user: string): Promise<T | null> {
    const res = await this.chatService.chat(
      [
        { role: 'system', content: system },
        { role: 'user', content: user },
      ],
      { model: CHAT_MODEL, temperature: 0 }
    );
    return this.parseJSON<T>(res.text);
  }

  // ---- write path: extract -> reconcile -> store --------------------------

  private async extract(transcript: string): Promise<Candidate[]> {
    const parsed = await this.chatJSON<{ memories: Candidate[] }>(
      `Extract durable memories from an agent's task transcript.
Return JSON: {"memories":[{"kind":"fact"|"decision"|"preference"|"reference","title":"<one line>","content":"<atomic, self-contained fact>"}]}

Only keep durable, non-obvious details useful in FUTURE tasks: endpoints, credential/config locations, decisions AND their rationale, constraints, gotchas. One atomic, self-contained fact per memory (each readable without the others).

Skip transient details: what commands ran, intermediate errors that were fixed, progress narration, anything recoverable by reading the code.

Examples:
✅ {"kind":"reference","title":"Stripe webhook secret","content":"The staging Stripe webhook signing secret is in 1Password vault acme-infra, item stripe-staging."}
✅ {"kind":"decision","title":"tags as text[]","content":"snippets.tags uses a Postgres text[] column with a GIN index instead of a join table, chosen because tags are read-mostly and need no metadata."}
✅ {"kind":"fact","title":"insert format","content":"InsForge SDK inserts must be array-wrapped: .insert([{...}]); a bare object fails."}
❌ {"title":"ran migration","content":"Applied the migration and it succeeded."}   // transient
❌ {"title":"fixed test","content":"Fixed a flaky test by adding a retry."}            // transient, recoverable from code`,
      transcript
    );
    return parsed?.memories ?? [];
  }

  // Always-loadable index tier: every memory title for a scope, no embedding,
  // no LLM — cheap enough to load at session start so the agent knows what
  // it knows, then recall() full content on demand.
  async index(scope: string): Promise<Array<{ id: string; kind: MemoryKind; title: string; updated_at: string }>> {
    const pool = this.dbManager.getPool();
    const result = await pool.query(
      `SELECT id, kind, title, updated_at FROM memory.memories WHERE scope = $1 ORDER BY updated_at DESC`,
      [scope]
    );
    return result.rows.map((r) => ({
      id: r.id,
      kind: r.kind,
      title: r.title,
      updated_at: r.updated_at instanceof Date ? r.updated_at.toISOString() : String(r.updated_at),
    }));
  }

  private async findSimilar(scope: string, embedding: number[], k: number, threshold: number): Promise<SimilarRow[]> {
    const pool = this.dbManager.getPool();
    const lit = this.toVectorLiteral(embedding);
    const result = await pool.query(
      `SELECT id, kind, title, content,
              1 - (embedding <=> $1::vector) AS similarity
         FROM memory.memories
        WHERE scope = $2
          AND 1 - (embedding <=> $1::vector) > $3
        ORDER BY embedding <=> $1::vector
        LIMIT $4`,
      [lit, scope, threshold, k]
    );
    return result.rows as SimilarRow[];
  }

  private async rememberOne(scope: string, candidate: Candidate, source?: string): Promise<RememberResult> {
    const pool = this.dbManager.getPool();
    const embedding = await this.embed(`${candidate.title}\n${candidate.content}`);
    const similar = await this.findSimilar(scope, embedding, 3, RECONCILE_THRESHOLD);

    let action: 'ADD' | 'UPDATE' | 'NOOP' = 'ADD';
    let decision: { action: string; target_id?: string; title?: string; content?: string } | null = null;

    if (similar.length > 0) {
      decision = await this.chatJSON(
        `You maintain an agent memory store. Given a NEW candidate and EXISTING similar memories, decide exactly one:
"NOOP" — the candidate adds NO new information beyond an existing memory (even if worded differently).
"UPDATE" — the candidate corrects, supersedes, or adds detail to an existing memory; return target_id, title, content (merged).
"ADD" — genuinely new information.
Return JSON {"action":"ADD"|"UPDATE"|"NOOP","target_id"?:string,"title"?:string,"content"?:string}.`,
        JSON.stringify({ candidate, existing: similar })
      );
      const a = decision?.action;
      if (a === 'UPDATE' || a === 'NOOP') action = a;
    }

    if (action === 'ADD') {
      const res = await pool.query(
        `INSERT INTO memory.memories (scope, kind, title, content, embedding, embedding_model, source)
         VALUES ($1, $2, $3, $4, $5::vector, $6, $7)
         RETURNING id`,
        [scope, candidate.kind, candidate.title, candidate.content, this.toVectorLiteral(embedding), EMBED_MODEL, source ?? null]
      );
      return { action, id: res.rows[0].id, title: candidate.title };
    }

    if (action === 'UPDATE' && decision?.target_id) {
      const title = decision.title ?? candidate.title;
      const content = decision.content ?? candidate.content;
      const newEmbedding = await this.embed(`${title}\n${content}`);
      await pool.query(
        `UPDATE memory.memories
            SET title = $1, content = $2, embedding = $3::vector, source = $4
          WHERE id = $5 AND scope = $6`,
        [title, content, this.toVectorLiteral(newEmbedding), source ?? null, decision.target_id, scope]
      );
      return { action, id: decision.target_id, title };
    }

    // NOOP (or malformed UPDATE) — nothing written
    return { action: 'NOOP', title: candidate.title };
  }

  // ---- public API ---------------------------------------------------------

  async remember(params: {
    scope: string;
    source?: string;
    transcript?: string;
    kind?: MemoryKind;
    title?: string;
    content?: string;
  }): Promise<RememberResult[]> {
    const candidates: Candidate[] = params.transcript
      ? await this.extract(params.transcript)
      : [{ kind: params.kind ?? 'fact', title: params.title!, content: params.content! }];

    const results: RememberResult[] = [];
    for (const c of candidates) {
      results.push(await this.rememberOne(params.scope, c, params.source));
    }
    logger.debug('memory.remember', { scope: params.scope, stored: results.length });
    return results;
  }

  async recall(params: { scope: string; query: string; limit: number; threshold?: number }): Promise<RecalledMemory[]> {
    const embedding = await this.embed(params.query);
    const pool = this.dbManager.getPool();
    const threshold = params.threshold ?? DEFAULT_RECALL_THRESHOLD;
    // Hybrid recall via Reciprocal Rank Fusion (k=60, the standard constant):
    //  - vector arm keeps the cosine threshold, so unrelated queries still
    //    return nothing (no semantic noise);
    //  - keyword arm (full-text) catches exact tokens — identifiers, file
    //    paths, key names — that embeddings smear together.
    // A row matched by either arm is eligible; fused score ranks the union,
    // and a mild recency boost breaks ties toward current truth.
    const result = await pool.query(
      `WITH q AS (SELECT $1::vector AS qv, websearch_to_tsquery('english', $2) AS tsq),
       vec AS (
         SELECT m.id, 1 - (m.embedding <=> q.qv) AS sim,
                row_number() OVER (ORDER BY m.embedding <=> q.qv) AS rnk
           FROM memory.memories m, q
          WHERE m.scope = $3 AND 1 - (m.embedding <=> q.qv) > $4
          ORDER BY m.embedding <=> q.qv LIMIT 20
       ),
       kw AS (
         SELECT m.id,
                row_number() OVER (ORDER BY ts_rank(m.content_tsv, q.tsq) DESC) AS rnk
           FROM memory.memories m, q
          WHERE m.scope = $3 AND m.content_tsv @@ q.tsq
          ORDER BY ts_rank(m.content_tsv, q.tsq) DESC LIMIT 20
       ),
       fused AS (
         SELECT COALESCE(vec.id, kw.id) AS id,
                COALESCE(1.0/(60+vec.rnk), 0) + COALESCE(1.0/(60+kw.rnk), 0) AS rrf,
                vec.sim
           FROM vec FULL OUTER JOIN kw ON vec.id = kw.id
       )
       SELECT m.id, m.kind, m.title, m.content,
              COALESCE(f.sim, 1 - (m.embedding <=> q.qv)) AS similarity,
              m.updated_at
         FROM fused f
         JOIN memory.memories m ON m.id = f.id, q
        ORDER BY f.rrf + 0.0001 * extract(epoch FROM m.updated_at) / 1e9 DESC
        LIMIT $5`,
      [this.toVectorLiteral(embedding), params.query, params.scope, threshold, params.limit]
    );
    return result.rows.map((r) => ({
      id: r.id,
      kind: r.kind,
      title: r.title,
      content: r.content,
      similarity: Number(r.similarity),
      updated_at: r.updated_at instanceof Date ? r.updated_at.toISOString() : String(r.updated_at),
    }));
  }
}
