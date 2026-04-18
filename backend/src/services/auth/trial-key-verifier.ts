/**
 * Trial-key / user-agent-key verifier.
 *
 * OSS runs on a per-tenant Postgres; cloud-backend owns the `trial_users`
 * and `user_agent_keys` tables on a separate multi-tenant Postgres. This
 * service verifies bearer tokens against cloud via a signed HTTP request
 * to `POST {CLOUD_API_HOST}/internal/v1/verify-agent-key` and caches
 * positive verdicts in-memory so a single deploy flow's many requests
 * don't each cost a cloud round-trip.
 *
 * Key prefix detection is cheap and local; the HTTP call is skipped
 * entirely for non-trial bearers.
 *
 * Spec: docs/superpowers/specs/2026-04-18-deploy-trial-key-auth.md
 */
import crypto from 'crypto';

/** Trial-key prefix — mirrors cloud's `TRIAL_KEY_PREFIX`. */
export const TRIAL_KEY_PREFIX = 'ins_agent_trial_sk_';
/** Post-upgrade user-scoped agent-key prefix — mirrors cloud's `USER_AGENT_KEY_PREFIX`. */
export const USER_AGENT_KEY_PREFIX = 'ins_agent_sk_';

export function isTrialKey(token: string): boolean {
  return token.startsWith(TRIAL_KEY_PREFIX);
}

export function isUserAgentKey(token: string): boolean {
  return token.startsWith(USER_AGENT_KEY_PREFIX);
}

/** True for any agent-issued bearer (trial or post-upgrade). */
export function isAgentKey(token: string): boolean {
  return isTrialKey(token) || isUserAgentKey(token);
}

export interface TrialQuota {
  api_calls_day: number;
  storage_mb: number;
  compute_deploy_mb: number;
  compute_hours_day: number;
  bandwidth_gb_day: number;
  projects: number;
}

export type AgentKeyTier = 'trial' | 'user_agent_key';

export interface TrialContext {
  tier: AgentKeyTier;
  /** Present when tier='trial'. */
  trialUserId?: string;
  /** Present when tier='user_agent_key'. */
  userId?: string;
  projectId: string;
  organizationId: string;
  quota: TrialQuota;
  /** ISO-8601 UTC; present when tier='trial'. */
  expiresAt?: string;
}

export interface TrialKeyVerifierOptions {
  /** Defaults to `process.env.CLOUD_API_HOST` or `https://api.insforge.dev`. */
  cloudApiHost?: string;
  /** Defaults to `process.env.INTERNAL_SERVICE_SECRET`. */
  serviceSecret?: string;
  /** Cache TTL for positive verdicts, ms. Default 60_000. */
  cacheTtlMs?: number;
  /** Override fetch for testing. */
  fetchImpl?: typeof fetch;
  /** Override clock for testing. */
  now?: () => number;
}

interface CacheEntry {
  context: TrialContext;
  expiresAtMs: number;
}

/**
 * Fail-closed verifier. All failure modes (no secret, network error, non-2xx,
 * malformed body) collapse to `null`, which the middleware converts to 401.
 */
export class TrialKeyVerifier {
  private readonly cloudApiHost: string;
  private readonly serviceSecret: string;
  private readonly cacheTtlMs: number;
  private readonly fetchImpl: typeof fetch;
  private readonly now: () => number;
  private readonly cache = new Map<string, CacheEntry>();

  constructor(opts: TrialKeyVerifierOptions = {}) {
    this.cloudApiHost = (
      opts.cloudApiHost ??
      process.env.CLOUD_API_HOST ??
      'https://api.insforge.dev'
    ).replace(/\/+$/, '');
    this.serviceSecret = opts.serviceSecret ?? process.env.INTERNAL_SERVICE_SECRET ?? '';
    this.cacheTtlMs = opts.cacheTtlMs ?? 60_000;
    this.fetchImpl = opts.fetchImpl ?? fetch;
    this.now = opts.now ?? Date.now;
  }

  /**
   * Verify a plaintext bearer token. Returns the trial/user-agent context
   * on success, or null on any failure. Callers must treat null as a
   * 401-equivalent — never fall through to other auth branches.
   */
  async verify(token: string): Promise<TrialContext | null> {
    if (!isAgentKey(token)) return null;
    if (!this.serviceSecret) return null;

    // Cache key is the SHA256 of the plaintext so we don't hold raw keys in memory.
    const cacheKey = crypto.createHash('sha256').update(token).digest('hex');
    const cached = this.cache.get(cacheKey);
    if (cached && cached.expiresAtMs > this.now()) {
      return cached.context;
    }
    if (cached) {
      this.cache.delete(cacheKey);
    }

    const ts = Math.floor(this.now() / 1000).toString();
    const nonce = crypto.randomBytes(16).toString('hex');
    const body = JSON.stringify({ key: token });
    const signature = this.sign(ts, nonce, body);

    let response: Response;
    try {
      response = await this.fetchImpl(`${this.cloudApiHost}/internal/v1/verify-agent-key`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Service-Timestamp': ts,
          'X-Service-Nonce': nonce,
          'X-Service-Signature': `sha256=${signature}`,
        },
        body,
      });
    } catch {
      return null;
    }

    if (!response.ok) {
      // 401 from cloud = not valid. 5xx = cloud is down. Both fail closed.
      return null;
    }

    let parsed: unknown;
    try {
      parsed = await response.json();
    } catch {
      return null;
    }

    const context = parseVerifyResponse(parsed);
    if (!context) return null;

    this.cache.set(cacheKey, {
      context,
      expiresAtMs: this.now() + this.cacheTtlMs,
    });
    return context;
  }

  /**
   * Manually invalidate a cached verdict. Not wired into any production
   * path yet — exposed for tests and for a future admin-revoke webhook.
   */
  invalidate(token: string): void {
    const cacheKey = crypto.createHash('sha256').update(token).digest('hex');
    this.cache.delete(cacheKey);
  }

  private sign(ts: string, nonce: string, body: string): string {
    return crypto
      .createHmac('sha256', this.serviceSecret)
      .update(`${ts}.${nonce}.${body}`)
      .digest('hex');
  }
}

function parseVerifyResponse(raw: unknown): TrialContext | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>;
  if (r.valid !== true) return null;

  const tierRaw = r.tier;
  if (tierRaw !== 'trial' && tierRaw !== 'user_agent_key') return null;
  const tier = tierRaw as AgentKeyTier;

  const projectId = asString(r.project_id);
  const organizationId = asString(r.organization_id);
  if (!projectId || !organizationId) return null;

  const quota = parseQuota(r.quota);
  if (!quota) return null;

  const ctx: TrialContext = {
    tier,
    projectId,
    organizationId,
    quota,
  };
  const trialUserId = asString(r.trial_user_id);
  if (trialUserId) ctx.trialUserId = trialUserId;
  const userId = asString(r.user_id);
  if (userId) ctx.userId = userId;
  const expiresAt = asString(r.expires_at);
  if (expiresAt) ctx.expiresAt = expiresAt;

  if (tier === 'trial' && !ctx.trialUserId) return null;
  if (tier === 'user_agent_key' && !ctx.userId) return null;

  return ctx;
}

function parseQuota(raw: unknown): TrialQuota | null {
  if (!raw || typeof raw !== 'object') return null;
  const q = raw as Record<string, unknown>;
  const fields: (keyof TrialQuota)[] = [
    'api_calls_day',
    'storage_mb',
    'compute_deploy_mb',
    'compute_hours_day',
    'bandwidth_gb_day',
    'projects',
  ];
  const out = {} as TrialQuota;
  for (const f of fields) {
    const v = q[f];
    if (typeof v !== 'number' || !Number.isFinite(v)) return null;
    out[f] = v;
  }
  return out;
}

function asString(v: unknown): string | undefined {
  return typeof v === 'string' && v.length > 0 ? v : undefined;
}

// Lazy singleton — constructed on first access so env vars resolve post-dotenv.
let singleton: TrialKeyVerifier | null = null;
export function getTrialKeyVerifier(): TrialKeyVerifier {
  if (!singleton) singleton = new TrialKeyVerifier();
  return singleton;
}

/** Test-only: reset the lazy singleton so a fresh verifier picks up env changes. */
export function __resetTrialKeyVerifierForTests(): void {
  singleton = null;
}
