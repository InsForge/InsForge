/**
 * Trial-quota enforcement for OSS deploy routes.
 *
 * Runs AFTER `verifyAdminOrTrialAgent`. If the request authenticated via an
 * admin JWT / `ik_*` key (no `req.trial`), this is a no-op — admins have no
 * trial quota.
 *
 * On trial / user-agent-key requests we gate on:
 *   - trial expiry (tier='trial' only; `expiresAt > now`)
 *   - per-file upload size (`Content-Length` against `quota.storage_mb`)
 *   - `compute_deploy_mb > 0` sanity (prevents a config-zero'd quota from
 *      letting a deploy through)
 *
 * Bandwidth (`bandwidth_gb_day`) is enforced by the compute layer on serve —
 * out of this middleware's scope — but the value is surfaced on `req.trial.quota`
 * so downstream consumers can read it.
 *
 * Failure shape is always HTTP 402 with
 *   {error: "claim_required", reason: string, claim_url: string | null}
 * — the `claim_url` convention matches cloud-backend's signup response and
 * ticket #445's trigger matrix.
 *
 * Spec: docs/superpowers/specs/2026-04-18-deploy-trial-key-auth.md
 */
import { Response, NextFunction } from 'express';
import { AuthRequest } from './auth.js';

const BYTES_PER_MB = 1024 * 1024;

export interface TrialQuotaResult {
  /** true if the request should proceed. */
  allowed: boolean;
  /** Populated when allowed=false. */
  reason?: 'trial_expired' | 'storage_exceeded' | 'compute_deploy_zero';
  /** Bytes the request was attempting to upload (when reason='storage_exceeded'). */
  attemptedBytes?: number;
  /** Max bytes allowed (when reason='storage_exceeded'). */
  maxBytes?: number;
}

/**
 * Pure evaluator — easy to unit test. No I/O, no mutations.
 * `contentLength` is the bytes the request is trying to upload. Pass `null`
 * for routes that don't upload (e.g. `POST /api/deployments`).
 */
export function evaluateTrialDeployQuota(
  req: AuthRequest,
  contentLength: number | null,
  now: Date = new Date()
): TrialQuotaResult {
  const trial = req.trial;
  if (!trial) return { allowed: true };

  // Trial expiry — only enforced for tier='trial' (user_agent_key is long-lived).
  if (trial.tier === 'trial' && trial.expiresAt) {
    const expiresAt = new Date(trial.expiresAt);
    if (!Number.isNaN(expiresAt.getTime()) && expiresAt.getTime() <= now.getTime()) {
      return { allowed: false, reason: 'trial_expired' };
    }
  }

  // A quota with compute_deploy_mb=0 means "never allow a deploy". Fail fast.
  if (trial.quota.compute_deploy_mb <= 0) {
    return { allowed: false, reason: 'compute_deploy_zero' };
  }

  // Per-file upload check. Use the smaller of storage_mb (cumulative cap) and
  // compute_deploy_mb (per-bundle cap) as the upper bound for this request.
  if (contentLength !== null && contentLength > 0) {
    const maxMb = Math.min(trial.quota.storage_mb, trial.quota.compute_deploy_mb);
    const maxBytes = maxMb * BYTES_PER_MB;
    if (contentLength > maxBytes) {
      return {
        allowed: false,
        reason: 'storage_exceeded',
        attemptedBytes: contentLength,
        maxBytes,
      };
    }
  }

  return { allowed: true };
}

/**
 * Build the claim URL for a 402 body. Returns `null` when no URL makes sense
 * (e.g. a user_agent_key is already claimed).
 */
export function buildClaimUrl(req: AuthRequest): string | null {
  const trial = req.trial;
  if (!trial) return null;
  if (trial.tier !== 'trial' || !trial.trialUserId) return null;
  const host = (process.env.CLOUD_API_HOST ?? 'https://api.insforge.dev').replace(/\/+$/, '');
  return `${host}/claim/${trial.trialUserId}`;
}

/**
 * Express middleware. Rejects with 402 `{error: "claim_required", …}` when
 * quota is exhausted; otherwise calls next().
 */
export function checkTrialDeployQuota(req: AuthRequest, res: Response, next: NextFunction): void {
  const contentLengthHeader = req.headers['content-length'];
  const contentLength =
    typeof contentLengthHeader === 'string' && contentLengthHeader.length > 0
      ? Number.parseInt(contentLengthHeader, 10)
      : null;
  const parsedContentLength =
    contentLength !== null && Number.isFinite(contentLength) ? contentLength : null;

  const result = evaluateTrialDeployQuota(req, parsedContentLength);
  if (result.allowed) {
    next();
    return;
  }

  res.status(402).json({
    error: 'claim_required',
    reason: result.reason,
    claim_url: buildClaimUrl(req),
    ...(result.reason === 'storage_exceeded'
      ? {
          attempted_bytes: result.attemptedBytes,
          max_bytes: result.maxBytes,
        }
      : {}),
  });
}
