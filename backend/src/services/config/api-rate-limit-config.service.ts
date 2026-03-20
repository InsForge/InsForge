import { Pool } from "pg";
import { DatabaseManager } from "@/infra/database/database.manager.js";
import { AppError } from "@/api/middlewares/error.js";
import { ERROR_CODES } from "@/types/error-constants.js";
import logger from "@/utils/logger.js";
import type {
  ApiRateLimitConfigSchema,
  UpdateApiRateLimitConfigRequest,
} from "@insforge/shared-schemas";

const DEFAULT_API_RATE_LIMIT_CONFIG: Omit<
  ApiRateLimitConfigSchema,
  "id" | "createdAt" | "updatedAt"
> = {
  sendEmailOtpMaxRequests: 5,
  sendEmailOtpWindowMinutes: 15,
  verifyOtpMaxRequests: 10,
  verifyOtpWindowMinutes: 15,
  emailCooldownSeconds: 60,
};

export class ApiRateLimitConfigService {
  private static instance: ApiRateLimitConfigService;
  private pool: Pool | null = null;

  private constructor() {
    logger.info("ApiRateLimitConfigService initialized");
  }

  public static getInstance(): ApiRateLimitConfigService {
    if (!ApiRateLimitConfigService.instance) {
      ApiRateLimitConfigService.instance = new ApiRateLimitConfigService();
    }
    return ApiRateLimitConfigService.instance;
  }

  private getPool(): Pool {
    if (!this.pool) {
      this.pool = DatabaseManager.getInstance().getPool();
    }
    return this.pool;
  }

  async getApiRateLimitConfig(): Promise<ApiRateLimitConfigSchema> {
    try {
      const result = await this.getPool().query(
        `SELECT
          id,
          send_email_otp_max_requests as "sendEmailOtpMaxRequests",
          send_email_otp_window_minutes as "sendEmailOtpWindowMinutes",
          verify_otp_max_requests as "verifyOtpMaxRequests",
          verify_otp_window_minutes as "verifyOtpWindowMinutes",
          email_cooldown_seconds as "emailCooldownSeconds",
          created_at as "createdAt",
          updated_at as "updatedAt"
         FROM system.api_rate_limit_config
         LIMIT 1`,
      );

      if (!result.rows.length) {
        logger.warn(
          "No API rate limit config found, returning default fallback values",
        );
        return this.buildFallbackConfig();
      }

      return result.rows[0];
    } catch (error) {
      logger.error(
        "Failed to get API rate limit config, returning default fallback values",
        {
          error,
        },
      );
      return this.buildFallbackConfig();
    }
  }

  async updateApiRateLimitConfig(
    input: UpdateApiRateLimitConfigRequest,
  ): Promise<ApiRateLimitConfigSchema> {
    const client = await this.getPool().connect();
    try {
      await client.query("BEGIN");

      const existingResult = await client.query(
        "SELECT id FROM system.api_rate_limit_config LIMIT 1 FOR UPDATE",
      );

      let result;
      if (!existingResult.rows.length) {
        result = await client.query(
          `INSERT INTO system.api_rate_limit_config (
             send_email_otp_max_requests,
             send_email_otp_window_minutes,
             verify_otp_max_requests,
             verify_otp_window_minutes,
             email_cooldown_seconds
           )
           VALUES ($1, $2, $3, $4, $5)
           RETURNING
             id,
             send_email_otp_max_requests as "sendEmailOtpMaxRequests",
             send_email_otp_window_minutes as "sendEmailOtpWindowMinutes",
             verify_otp_max_requests as "verifyOtpMaxRequests",
             verify_otp_window_minutes as "verifyOtpWindowMinutes",
             email_cooldown_seconds as "emailCooldownSeconds",
             created_at as "createdAt",
             updated_at as "updatedAt"`,
          [
            input.sendEmailOtpMaxRequests,
            input.sendEmailOtpWindowMinutes,
            input.verifyOtpMaxRequests,
            input.verifyOtpWindowMinutes,
            input.emailCooldownSeconds,
          ],
        );
      } else {
        result = await client.query(
          `UPDATE system.api_rate_limit_config
           SET send_email_otp_max_requests = $1,
               send_email_otp_window_minutes = $2,
               verify_otp_max_requests = $3,
               verify_otp_window_minutes = $4,
               email_cooldown_seconds = $5,
               updated_at = NOW()
           RETURNING
             id,
             send_email_otp_max_requests as "sendEmailOtpMaxRequests",
             send_email_otp_window_minutes as "sendEmailOtpWindowMinutes",
             verify_otp_max_requests as "verifyOtpMaxRequests",
             verify_otp_window_minutes as "verifyOtpWindowMinutes",
             email_cooldown_seconds as "emailCooldownSeconds",
             created_at as "createdAt",
             updated_at as "updatedAt"`,
          [
            input.sendEmailOtpMaxRequests,
            input.sendEmailOtpWindowMinutes,
            input.verifyOtpMaxRequests,
            input.verifyOtpWindowMinutes,
            input.emailCooldownSeconds,
          ],
        );
      }

      await client.query("COMMIT");
      logger.info("API rate limit config updated", input);
      return result.rows[0];
    } catch (error) {
      try {
        await client.query("ROLLBACK");
      } catch (rollbackError) {
        logger.error("Rollback failed", { rollbackError });
      }

      logger.error("Failed to update API rate limit config", { error });
      if (error instanceof AppError) {
        throw error;
      }
      throw new AppError(
        "Failed to update API rate limit configuration",
        500,
        ERROR_CODES.INTERNAL_ERROR,
      );
    } finally {
      client.release();
    }
  }

  private buildFallbackConfig(): ApiRateLimitConfigSchema {
    return {
      id: "00000000-0000-0000-0000-000000000000",
      ...DEFAULT_API_RATE_LIMIT_CONFIG,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
  }
}
