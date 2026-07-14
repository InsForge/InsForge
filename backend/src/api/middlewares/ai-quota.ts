import { Response, NextFunction } from 'express';
import { AuthRequest } from './auth.js';
import { AIQuotaService } from '@/services/ai/ai-quota.service.js';
import { AIUsageService } from '@/services/ai/ai-usage.service.js';
import { AppError } from '@/utils/errors.js';
import { ERROR_CODES } from '@insforge/shared-schemas';
import logger from '@/utils/logger.js';

/**
 * Per-user AI quota enforcement middleware.
 *
 * Checks the user's current usage against their effective quota config
 * (per-user override or global default). Rejects with 429 if any limit
 * is exceeded.
 *
 * This middleware should run AFTER verifyUser so req.user is populated.
 */
export async function enforceAIQuota(req: AuthRequest, _res: Response, next: NextFunction) {
  try {
    const userId = req.user?.id;
    if (!userId) {
      // No authenticated user — let verifyUser handle it
      return next();
    }

    // Admin/API-key requests bypass quota enforcement
    if (req.hasApiKey || req.user?.role === 'project_admin') {
      return next();
    }

    const quotaService = AIQuotaService.getInstance();
    const quota = await quotaService.getEffectiveQuota(userId);

    // No quota configured or quotas disabled — allow through
    if (!quota || !quota.isEnabled) {
      return next();
    }

    // Check model allowlist
    const model = req.body?.model;
    if (model && quota.allowedModels && quota.allowedModels.length > 0) {
      if (!quota.allowedModels.includes(model)) {
        throw new AppError(
          `Model "${model}" is not in your allowed models list.`,
          403,
          ERROR_CODES.FORBIDDEN
        );
      }
    }

    // Check usage limits
    const hasLimits =
      quota.maxRequestsPerDay !== null ||
      quota.maxTokensPerDay !== null ||
      quota.maxTokensPerMonth !== null ||
      quota.maxSpendUsdPerMonth !== null;

    if (!hasLimits) {
      return next();
    }

    const usageService = AIUsageService.getInstance();
    const stats = await usageService.getUserStats(userId);

    if (quota.maxRequestsPerDay !== null && stats.requestsToday >= quota.maxRequestsPerDay) {
      throw new AppError(
        `Daily request limit reached (${quota.maxRequestsPerDay} requests/day). Try again tomorrow.`,
        429,
        ERROR_CODES.RATE_LIMITED
      );
    }

    if (quota.maxTokensPerDay !== null && stats.tokensToday >= quota.maxTokensPerDay) {
      throw new AppError(
        `Daily token limit reached (${quota.maxTokensPerDay} tokens/day). Try again tomorrow.`,
        429,
        ERROR_CODES.RATE_LIMITED
      );
    }

    if (quota.maxTokensPerMonth !== null && stats.tokensThisMonth >= quota.maxTokensPerMonth) {
      throw new AppError(
        `Monthly token limit reached (${quota.maxTokensPerMonth} tokens/month). Resets next month.`,
        429,
        ERROR_CODES.RATE_LIMITED
      );
    }

    if (quota.maxSpendUsdPerMonth !== null && stats.costThisMonth >= quota.maxSpendUsdPerMonth) {
      // Note: spend tracking requires cost estimation to be wired into recordUsage().
      // Until then, this check only triggers if costs are manually populated.
      throw new AppError(
        `Monthly spend cap reached ($${quota.maxSpendUsdPerMonth}/month). Resets next month.`,
        429,
        ERROR_CODES.RATE_LIMITED
      );
    }

    next();
  } catch (error) {
    if (error instanceof AppError) {
      return next(error);
    }
    // Quota check failure should not block requests — log and allow through
    logger.error('AI quota check failed, allowing request', {
      error: error instanceof Error ? error.message : String(error),
      userId: req.user?.id,
    });
    next();
  }
}
