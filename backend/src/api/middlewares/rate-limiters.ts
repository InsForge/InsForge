import rateLimit from 'express-rate-limit';
import { Request, Response, NextFunction } from 'express';
import { AppError } from './error.js';
import { ERROR_CODES } from '@/types/error-constants.js';
import logger from '@/utils/logger.js';

/**
 * Store for tracking per-email cooldowns
 * Maps email -> last request timestamp
 */
const emailCooldowns = new Map<string, number>();

/**
 * Cleanup interval reference for graceful shutdown
 */
let cleanupInterval: NodeJS.Timeout | null = null;

/**
 * Cleanup old cooldown entries every 5 minutes
 */
cleanupInterval = setInterval(
  () => {
    const now = Date.now();
    const fiveMinutes = 5 * 60 * 1000;

    for (const [email, timestamp] of emailCooldowns.entries()) {
      if (now - timestamp > fiveMinutes) {
        emailCooldowns.delete(email);
      }
    }
  },
  5 * 60 * 1000
);

/**
 * Clean up resources for graceful shutdown
 */
export function destroyEmailCooldownInterval(): void {
  if (cleanupInterval) {
    clearInterval(cleanupInterval);
    cleanupInterval = null;
  }
  emailCooldowns.clear();
}

/**
 * Per-IP rate limiter for email otp requests
 * Prevents brute-force attacks, resource exhaustion, and enumeration from single IP
 *
 * Limits: 5 requests per 15 minutes per IP
 * Counts ALL requests (both successful and failed) to prevent abuse
 */
export const sendEmailOTPRateLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 5, // Limit each IP to 5 requests per windowMs
  standardHeaders: true, // Return rate limit info in the `RateLimit-*` headers
  legacyHeaders: false, // Disable the `X-RateLimit-*` headers
  handler: (_req: Request, _res: Response, next: NextFunction) => {
    next(
      new AppError(
        'Too many send email verification requests from this IP. Please try again in 15 minutes.',
        429,
        ERROR_CODES.TOO_MANY_REQUESTS
      )
    );
  },
  // Count all requests (both successes and failures) to prevent resource exhaustion and enumeration
  skipSuccessfulRequests: false,
  skipFailedRequests: false,
});

/**
 * Per-IP rate limiter for S3 access key management endpoints.
 * These endpoints mint / revoke long-lived credentials, so tight limits
 * prevent credential spraying or key-churn abuse from a single IP.
 *
 * Limits: 20 requests per 15 minutes per IP (shared across POST/GET/DELETE).
 */
export const s3AccessKeyManagementRateLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 20,
  standardHeaders: true,
  legacyHeaders: false,
  handler: (_req: Request, _res: Response, next: NextFunction) => {
    next(
      new AppError(
        'Too many S3 access key management requests from this IP. Please try again in 15 minutes.',
        429,
        ERROR_CODES.TOO_MANY_REQUESTS
      )
    );
  },
  skipSuccessfulRequests: false,
  skipFailedRequests: false,
});

/**
 * Per-IP rate limiter for email OTP verification attempts
 * Prevents brute-force code guessing
 *
 * Limits: 10 attempts per 15 minutes per IP
 */
export const verifyOTPRateLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 10, // Limit each IP to 10 verification attempts per windowMs
  standardHeaders: true,
  legacyHeaders: false,
  handler: (_req: Request, _res: Response, next: NextFunction) => {
    next(
      new AppError(
        'Too many verification attempts from this IP. Please try again in 15 minutes.',
        429,
        ERROR_CODES.TOO_MANY_REQUESTS
      )
    );
  },
  skipSuccessfulRequests: true, // Don't count successful verifications
  skipFailedRequests: false, // Count failed attempts to prevent brute force
});

/**
 * Per-email cooldown middleware
 * Prevents enumeration attacks by enforcing minimum time between requests for same email
 *
 * Cooldown: 60 seconds between requests for same email
 */
export const perEmailCooldown = (cooldownMs: number = 60000) => {
  return (req: Request, _res: Response, next: NextFunction) => {
    const email = req.body?.email?.toLowerCase();

    if (!email) {
      // If no email in body, let it pass (will be caught by validation)
      return next();
    }

    const now = Date.now();
    const lastRequest = emailCooldowns.get(email);

    if (lastRequest && now - lastRequest < cooldownMs) {
      const remainingMs = cooldownMs - (now - lastRequest);
      const remainingSec = Math.ceil(remainingMs / 1000);

      throw new AppError(
        `Please wait ${remainingSec} seconds before requesting another code for this email`,
        429,
        ERROR_CODES.TOO_MANY_REQUESTS
      );
    }

    // Update last request time
    emailCooldowns.set(email, now);
    next();
  };
};

/**
 * Combined rate limiter for sending email otp requests
 * Applies both per-IP and per-email limits
 */
export const sendEmailOTPLimiter = [
  sendEmailOTPRateLimiter,
  perEmailCooldown(60000), // 60 second cooldown per email
];

/**
 * Rate limiter for OTP verification attempts (email OTP verification)
 * Only per-IP limit, no per-email limit (to allow legitimate retries)
 */
export const verifyOTPLimiter = [verifyOTPRateLimiter];

/**
 * Per-IP rate limiters for "write" endpoints that ultimately drive an external
 * provider call.
 *
 * Goal: stop a single admin's runaway script from monopolising the platform's
 * shared upstream provider quotas — Vercel `Token creation 32/hr`, Vercel
 * `Deployments per 5min: 120`, Fly `app deletions: 100/min`, Deno
 * `Deployments per hour: 60`, etc.
 *
 * Each provider category gets its own bucket so a noisy compute deploy loop
 * cannot starve a legitimate function update (and vice versa). The defaults
 * (see DEFAULT_WRITE_ENDPOINT_LIMITS) are generous for human-driven CRUD;
 * CI loops are expected to deploy once per commit and stay well below them.
 *
 * Operators can override per-category budgets at runtime by uploading a JSON
 * file to the AWS_CONFIG_BUCKET at key `resource-rate-limits.json`:
 *   { "functions": 20, "deployments": 40, "compute": 15 }
 * The file is fetched on startup and refreshed on a periodic timer
 * (default 1 hour; tune via INSFORGE_WRITE_RATE_LIMIT_REFRESH_MS, set to 0
 * for startup-only). Any missing or invalid (non-positive-integer) field
 * falls back to the built-in default.
 *
 * Counts ALL requests (skipFailedRequests: false) so a buggy script that
 * loops on a 4xx response can't bypass the cap.
 *
 * Within a category, the budget is shared across every wired endpoint — e.g.
 * a deploy create + an env-var write + a domain add all count toward the
 * same per-IP `deployments` budget.
 *
 * E2E suites that exercise many write endpoints from one IP can opt out by
 * setting `INSFORGE_DISABLE_WRITE_RATE_LIMIT=1`. The check is deliberately
 * an explicit named flag (not `NODE_ENV`) so unit tests still exercise the
 * limiter and prod can never accidentally bypass via test envs.
 */
export type WriteLimiterCategory = 'functions' | 'deployments' | 'compute';

function isWriteRateLimitDisabled(): boolean {
  return process.env.INSFORGE_DISABLE_WRITE_RATE_LIMIT === '1';
}

/**
 * Per-category default budgets used when no S3 override is loaded. These are
 * the values the limiter uses out-of-the-box and the fallback whenever the
 * S3 config file is absent, unreadable, or missing a category.
 */
export const DEFAULT_WRITE_ENDPOINT_LIMITS: Readonly<Record<WriteLimiterCategory, number>> =
  Object.freeze({
    functions: 15,
    deployments: 25,
    compute: 15,
  });

/**
 * Mutable copy of the active per-category budgets. Reads happen on every
 * request via `getWriteEndpointLimit`; writes happen on startup and during
 * the periodic S3 refresh.
 */
const currentWriteEndpointLimits: Record<WriteLimiterCategory, number> = {
  ...DEFAULT_WRITE_ENDPOINT_LIMITS,
};

/**
 * Public URL of the live override file. Expected shape:
 * `{ "functions"?: number, "deployments"?: number, "compute"?: number }`.
 * Any missing or invalid (non-positive-integer) field falls back to the default.
 *
 * Self-hosters can pin their own config by setting
 * INSFORGE_WRITE_RATE_LIMIT_CONFIG_URL. Plain HTTPS is used instead of the
 * AWS SDK so the fetch works on instances without AWS credentials and never
 * gets rejected because the runtime's signing identity lacks read access to
 * a public bucket.
 */
const DEFAULT_WRITE_ENDPOINT_LIMITS_URL = 'https://config.insforge.dev/resource-rate-limits.json';

function getWriteEndpointLimitsUrl(): string {
  return process.env.INSFORGE_WRITE_RATE_LIMIT_CONFIG_URL || DEFAULT_WRITE_ENDPOINT_LIMITS_URL;
}

const WRITE_ENDPOINT_LIMITS_FETCH_TIMEOUT_MS = 5_000;

export function getWriteEndpointLimit(category: WriteLimiterCategory): number {
  return currentWriteEndpointLimits[category];
}

/**
 * Pure merge step: validate the partial config and update the live map.
 * Exported for tests so they can simulate an S3-driven override without
 * actually touching S3.
 */
export function applyWriteEndpointLimits(
  partial: Partial<Record<WriteLimiterCategory, unknown>>
): void {
  for (const category of Object.keys(DEFAULT_WRITE_ENDPOINT_LIMITS) as WriteLimiterCategory[]) {
    const raw = partial[category];
    if (raw === undefined) {
      continue;
    }
    if (typeof raw === 'number' && Number.isInteger(raw) && raw > 0) {
      currentWriteEndpointLimits[category] = raw;
    } else {
      logger.warn(
        `Ignoring invalid write-endpoint rate limit for "${category}": expected positive integer, got ${JSON.stringify(raw)}`
      );
    }
  }
}

/**
 * Reset all categories back to defaults. Used by the refresh loop so a
 * previously-set override that is later removed from S3 reverts cleanly,
 * and by tests for isolation.
 */
export function resetWriteEndpointLimitsToDefaults(): void {
  Object.assign(currentWriteEndpointLimits, DEFAULT_WRITE_ENDPOINT_LIMITS);
}

async function fetchWriteEndpointLimitsConfig(): Promise<Partial<
  Record<WriteLimiterCategory, unknown>
> | null> {
  const url = getWriteEndpointLimitsUrl();
  try {
    const response = await fetch(url, {
      signal: AbortSignal.timeout(WRITE_ENDPOINT_LIMITS_FETCH_TIMEOUT_MS),
    });
    if (!response.ok) {
      // 404 is the "no override published" case and is expected; anything
      // else is worth surfacing so operators notice misconfigured policies.
      if (response.status !== 404) {
        logger.warn(
          `Failed to fetch write-endpoint rate-limit config from ${url}: HTTP ${response.status}`
        );
      }
      return null;
    }
    return (await response.json()) as Partial<Record<WriteLimiterCategory, unknown>>;
  } catch (error) {
    logger.warn(`Failed to fetch write-endpoint rate-limit config from ${url}`, {
      error: error instanceof Error ? error.message : String(error),
    });
    return null;
  }
}

async function loadWriteEndpointLimitsFromS3(): Promise<void> {
  const config = await fetchWriteEndpointLimitsConfig();
  // Always reset first so a category dropped from the file reverts to its
  // default rather than sticking at the last fetched value.
  resetWriteEndpointLimitsToDefaults();
  if (config && typeof config === 'object') {
    applyWriteEndpointLimits(config);
  }
}

/**
 * Default cadence at which each backend instance refetches the override
 * file. Rate-limit policy changes don't need sub-minute propagation, and a
 * lower cadence keeps the per-bucket request volume modest when many
 * self-hosted instances are running.
 *
 * Override via INSFORGE_WRITE_RATE_LIMIT_REFRESH_MS (e.g. `300000` for the
 * old 5-minute cadence, or `0` to disable periodic refresh and only fetch
 * once at startup).
 */
const DEFAULT_WRITE_ENDPOINT_LIMITS_REFRESH_MS = 60 * 60 * 1000; // 1 hour

function getWriteEndpointLimitsRefreshMs(): number {
  const raw = process.env.INSFORGE_WRITE_RATE_LIMIT_REFRESH_MS;
  if (raw === undefined) {
    return DEFAULT_WRITE_ENDPOINT_LIMITS_REFRESH_MS;
  }
  const parsed = Number.parseInt(raw, 10);
  if (Number.isFinite(parsed) && parsed >= 0) {
    return parsed;
  }
  logger.warn(
    `Ignoring invalid INSFORGE_WRITE_RATE_LIMIT_REFRESH_MS=${JSON.stringify(raw)} ` +
      `(expected non-negative integer); using default ${DEFAULT_WRITE_ENDPOINT_LIMITS_REFRESH_MS}ms`
  );
  return DEFAULT_WRITE_ENDPOINT_LIMITS_REFRESH_MS;
}

let writeLimitsRefreshTimeout: NodeJS.Timeout | null = null;

/**
 * Kick off the initial S3 fetch and start the periodic refresh. Safe to call
 * more than once — subsequent calls are no-ops while a refresh is already
 * scheduled. Uses recursive setTimeout (rather than setInterval) so each
 * cycle re-reads the env-configurable cadence and adds a small jitter,
 * preventing a fleet of co-deployed instances from stampeding the bucket
 * on the same schedule.
 */
export function startWriteEndpointLimitsRefresh(): void {
  if (writeLimitsRefreshTimeout) {
    return;
  }
  // Fire-and-forget initial load: defaults remain in effect until it resolves.
  void loadWriteEndpointLimitsFromS3();
  const scheduleNext = () => {
    const base = getWriteEndpointLimitsRefreshMs();
    if (base === 0) {
      // Operator opted out of periodic refresh — startup fetch only.
      return;
    }
    const jitter = Math.floor(Math.random() * base * 0.1);
    writeLimitsRefreshTimeout = setTimeout(() => {
      void loadWriteEndpointLimitsFromS3();
      scheduleNext();
    }, base + jitter);
    // Don't keep the event loop alive just for config polling.
    writeLimitsRefreshTimeout.unref?.();
  };
  scheduleNext();
}

export function destroyWriteEndpointLimitsRefresh(): void {
  if (writeLimitsRefreshTimeout) {
    clearTimeout(writeLimitsRefreshTimeout);
    writeLimitsRefreshTimeout = null;
  }
}

// Skip the live S3 refresh under vitest so unit tests get deterministic
// defaults and don't fire network calls on import.
if (process.env.NODE_ENV !== 'test') {
  startWriteEndpointLimitsRefresh();
}

function createWriteEndpointLimiter(category: WriteLimiterCategory) {
  return rateLimit({
    windowMs: 5 * 60 * 1000, // 5 minutes
    // Function form so the limiter picks up the latest S3-driven value on
    // every request without needing to rebuild the middleware.
    max: () => getWriteEndpointLimit(category),
    standardHeaders: true,
    legacyHeaders: false,
    skip: () => isWriteRateLimitDisabled(),
    handler: (_req: Request, _res: Response, next: NextFunction) => {
      next(
        new AppError(
          `Too many ${category} write requests. Please wait a few minutes and try again.`,
          429,
          ERROR_CODES.TOO_MANY_REQUESTS
        )
      );
    },
    skipSuccessfulRequests: false,
    skipFailedRequests: false,
  });
}

export const functionsWriteLimiter = createWriteEndpointLimiter('functions');
export const deploymentsWriteLimiter = createWriteEndpointLimiter('deployments');
export const computeWriteLimiter = createWriteEndpointLimiter('compute');
