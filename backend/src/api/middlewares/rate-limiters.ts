import { Request, Response, NextFunction } from 'express';
import { AppError } from './error.js';
import { ERROR_CODES } from '@/types/error-constants.js';
import type { ApiRateLimitConfigSchema } from '@insforge/shared-schemas';

/**
 * Store for tracking per-email cooldowns
 * Maps email -> last request timestamp
 */
const emailCooldowns = new Map<string, number>();
const sendEmailOtpRequestsByIp = new Map<string, number[]>();
const verifyOtpRequestsByIp = new Map<string, number[]>();

type RuntimeApiRateLimitConfig = Pick<
  ApiRateLimitConfigSchema,
  | 'sendEmailOtpMaxRequests'
  | 'sendEmailOtpWindowMinutes'
  | 'verifyOtpMaxRequests'
  | 'verifyOtpWindowMinutes'
  | 'emailCooldownSeconds'
>;

const DEFAULT_API_RATE_LIMIT_CONFIG: RuntimeApiRateLimitConfig = {
  sendEmailOtpMaxRequests: 5,
  sendEmailOtpWindowMinutes: 15,
  verifyOtpMaxRequests: 10,
  verifyOtpWindowMinutes: 15,
  emailCooldownSeconds: 60,
};

let currentApiRateLimitConfig: RuntimeApiRateLimitConfig = { ...DEFAULT_API_RATE_LIMIT_CONFIG };

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
    const maxWindowMs =
      Math.max(
        currentApiRateLimitConfig.sendEmailOtpWindowMinutes,
        currentApiRateLimitConfig.verifyOtpWindowMinutes,
        5
      ) *
      60 *
      1000;

    for (const [email, timestamp] of emailCooldowns.entries()) {
      if (now - timestamp > maxWindowMs) {
        emailCooldowns.delete(email);
      }
    }

    cleanupIpRequests(sendEmailOtpRequestsByIp, maxWindowMs, now);
    cleanupIpRequests(verifyOtpRequestsByIp, maxWindowMs, now);
  },
  5 * 60 * 1000
);

function cleanupIpRequests(store: Map<string, number[]>, maxWindowMs: number, now: number): void {
  for (const [key, timestamps] of store.entries()) {
    const recent = timestamps.filter((timestamp) => now - timestamp < maxWindowMs);
    if (recent.length) {
      store.set(key, recent);
    } else {
      store.delete(key);
    }
  }
}

export function applyApiRateLimitConfig(config: RuntimeApiRateLimitConfig): void {
  currentApiRateLimitConfig = {
    sendEmailOtpMaxRequests: config.sendEmailOtpMaxRequests,
    sendEmailOtpWindowMinutes: config.sendEmailOtpWindowMinutes,
    verifyOtpMaxRequests: config.verifyOtpMaxRequests,
    verifyOtpWindowMinutes: config.verifyOtpWindowMinutes,
    emailCooldownSeconds: config.emailCooldownSeconds,
  };
}

function getClientIp(req: Request): string {
  return req.ip || req.socket.remoteAddress || 'unknown';
}

interface IpRateLimiterOptions {
  store: Map<string, number[]>;
  getWindowMs: () => number;
  getMaxRequests: () => number;
  getMessage: (windowMinutes: number) => string;
  countSuccessfulRequests: boolean;
  countFailedRequests: boolean;
}

function createIpRateLimiter(options: IpRateLimiterOptions) {
  return (req: Request, _res: Response, next: NextFunction) => {
    const now = Date.now();
    const ip = getClientIp(req);
    const windowMs = options.getWindowMs();
    const maxRequests = options.getMaxRequests();
    const recentRequests = (options.store.get(ip) || []).filter(
      (timestamp) => now - timestamp < windowMs
    );

    options.store.set(ip, recentRequests);

    if (recentRequests.length >= maxRequests) {
      return next(
        new AppError(
          options.getMessage(Math.ceil(windowMs / (60 * 1000))),
          429,
          ERROR_CODES.TOO_MANY_REQUESTS
        )
      );
    }

    let counted = false;
    req.res?.on('finish', () => {
      if (counted) {
        return;
      }
      counted = true;

      const statusCode = req.res?.statusCode ?? 500;
      const isSuccess = statusCode < 400;
      const shouldCount =
        (isSuccess && options.countSuccessfulRequests) ||
        (!isSuccess && options.countFailedRequests);

      if (!shouldCount) {
        return;
      }

      const currentWindowMs = options.getWindowMs();
      const currentTimestamps = (options.store.get(ip) || []).filter(
        (timestamp) => Date.now() - timestamp < currentWindowMs
      );
      currentTimestamps.push(Date.now());
      options.store.set(ip, currentTimestamps);
    });

    return next();
  };
}

/**
 * Clean up resources for graceful shutdown
 */
export function destroyEmailCooldownInterval(): void {
  if (cleanupInterval) {
    clearInterval(cleanupInterval);
    cleanupInterval = null;
  }
  clearRateLimitState();
}

export function clearRateLimitState(): void {
  emailCooldowns.clear();
  sendEmailOtpRequestsByIp.clear();
  verifyOtpRequestsByIp.clear();
}

/**
 * Per-IP rate limiter for email otp requests
 * Prevents brute-force attacks, resource exhaustion, and enumeration from single IP
 *
 * Limits: configured requests per configured window per IP
 * Counts ALL requests (both successful and failed) to prevent abuse
 */
export const sendEmailOTPRateLimiter = createIpRateLimiter({
  store: sendEmailOtpRequestsByIp,
  getWindowMs: () => currentApiRateLimitConfig.sendEmailOtpWindowMinutes * 60 * 1000,
  getMaxRequests: () => currentApiRateLimitConfig.sendEmailOtpMaxRequests,
  getMessage: (windowMinutes) =>
    `Too many send email verification requests from this IP. Please try again in ${windowMinutes} minutes.`,
  countSuccessfulRequests: true,
  countFailedRequests: true,
});

/**
 * Per-IP rate limiter for email OTP verification attempts
 * Prevents brute-force code guessing
 *
 * Limits: configured attempts per configured window per IP
 */
export const verifyOTPRateLimiter = createIpRateLimiter({
  store: verifyOtpRequestsByIp,
  getWindowMs: () => currentApiRateLimitConfig.verifyOtpWindowMinutes * 60 * 1000,
  getMaxRequests: () => currentApiRateLimitConfig.verifyOtpMaxRequests,
  getMessage: (windowMinutes) =>
    `Too many verification attempts from this IP. Please try again in ${windowMinutes} minutes.`,
  countSuccessfulRequests: false,
  countFailedRequests: true,
});

/**
 * Per-email cooldown middleware
 * Prevents enumeration attacks by enforcing minimum time between requests for same email
 *
 * Cooldown: configured seconds between requests for same email
 */
export const perEmailCooldown = (cooldownMs?: number) => {
  return (req: Request, _res: Response, next: NextFunction) => {
    const email = req.body?.email?.toLowerCase();

    if (!email) {
      // If no email in body, let it pass (will be caught by validation)
      return next();
    }

    const effectiveCooldownMs =
      cooldownMs ?? Math.max(0, currentApiRateLimitConfig.emailCooldownSeconds) * 1000;
    const now = Date.now();
    const lastRequest = emailCooldowns.get(email);

    if (lastRequest && now - lastRequest < effectiveCooldownMs) {
      const remainingMs = effectiveCooldownMs - (now - lastRequest);
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
export const sendEmailOTPLimiter = [sendEmailOTPRateLimiter, perEmailCooldown()];

/**
 * Rate limiter for OTP verification attempts (email OTP verification)
 * Only per-IP limit, no per-email limit (to allow legitimate retries)
 */
export const verifyOTPLimiter = [verifyOTPRateLimiter];
