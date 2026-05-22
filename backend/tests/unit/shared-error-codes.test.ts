import { describe, expect, it } from 'vitest';

import { ERROR_CODES, errorCodeSchema } from '@insforge/shared-schemas';

const sharedErrorCodes = ERROR_CODES;

describe('shared error codes', () => {
  /**
   * Full snapshot of the entire ERROR_CODES map.
   *
   * This snapshot pins every key/value pair so that accidental renames,
   * additions, or removals are caught immediately by CI. Update the snapshot
   * intentionally via `vitest -u` when the schema changes, and include a
   * rationale in the PR description.
   */
  it('matches the full snapshot of all exported error codes', () => {
    expect(sharedErrorCodes).toMatchSnapshot();
  });

  /**
   * Every error code must be a self-describing string — the value equals
   * the key. This invariant lets consumers compare error.code against a
   * plain string literal without importing the enum.
   */
  it('every code is a self-describing string (value === key)', () => {
    for (const [key, value] of Object.entries(sharedErrorCodes)) {
      expect(value).toBe(key);
    }
  });

  it('validates every exported error code through the Zod schema', () => {
    for (const value of Object.values(sharedErrorCodes)) {
      expect(errorCodeSchema.parse(value)).toBe(value);
    }
  });

  it('rejects unknown error codes', () => {
    expect(errorCodeSchema.safeParse('NOT_A_REAL_ERROR_CODE').success).toBe(false);
  });

  /**
   * Domain-specific codes introduced in the error-code migration.
   * These replace the generic NOT_FOUND / INVALID_INPUT / ALREADY_EXISTS
   * codes on the affected routes. Asserting them here makes the migration
   * contract explicit and gives a clear failure message if a code is
   * accidentally reverted.
   */
  describe('domain-specific codes (migration from generic codes)', () => {
    // Secrets module — replaced NOT_FOUND / ALREADY_EXISTS
    it('SECRET_NOT_FOUND is stable', () => {
      expect(sharedErrorCodes.SECRET_NOT_FOUND).toBe('SECRET_NOT_FOUND');
    });
    it('SECRET_ALREADY_EXISTS is stable', () => {
      expect(sharedErrorCodes.SECRET_ALREADY_EXISTS).toBe('SECRET_ALREADY_EXISTS');
    });

    // Deployments module — replaced NOT_FOUND / ALREADY_EXISTS / INVALID_INPUT
    it('DEPLOYMENT_NOT_FOUND is stable', () => {
      expect(sharedErrorCodes.DEPLOYMENT_NOT_FOUND).toBe('DEPLOYMENT_NOT_FOUND');
    });
    it('DEPLOYMENT_ALREADY_EXISTS is stable', () => {
      expect(sharedErrorCodes.DEPLOYMENT_ALREADY_EXISTS).toBe('DEPLOYMENT_ALREADY_EXISTS');
    });
    it('DEPLOYMENT_INVALID_FILE is stable', () => {
      expect(sharedErrorCodes.DEPLOYMENT_INVALID_FILE).toBe('DEPLOYMENT_INVALID_FILE');
    });

    // Domain management — replaced ALREADY_EXISTS / INVALID_INPUT / NOT_FOUND
    it('DOMAIN_ALREADY_EXISTS is stable', () => {
      expect(sharedErrorCodes.DOMAIN_ALREADY_EXISTS).toBe('DOMAIN_ALREADY_EXISTS');
    });
    it('DOMAIN_INVALID is stable', () => {
      expect(sharedErrorCodes.DOMAIN_INVALID).toBe('DOMAIN_INVALID');
    });
    it('DOMAIN_NOT_FOUND is stable', () => {
      expect(sharedErrorCodes.DOMAIN_NOT_FOUND).toBe('DOMAIN_NOT_FOUND');
    });

    // Schedules module — replaced INVALID_INPUT / NOT_FOUND
    it('SCHEDULE_INVALID_CRON is stable', () => {
      expect(sharedErrorCodes.SCHEDULE_INVALID_CRON).toBe('SCHEDULE_INVALID_CRON');
    });
    it('SCHEDULE_NOT_FOUND is stable', () => {
      expect(sharedErrorCodes.SCHEDULE_NOT_FOUND).toBe('SCHEDULE_NOT_FOUND');
    });

    // Payments module — replaced INVALID_INPUT / NOT_FOUND / ALREADY_EXISTS
    it('PAYMENT_CONFIG_INVALID is stable', () => {
      expect(sharedErrorCodes.PAYMENT_CONFIG_INVALID).toBe('PAYMENT_CONFIG_INVALID');
    });
    it('PAYMENT_NOT_FOUND is stable', () => {
      expect(sharedErrorCodes.PAYMENT_NOT_FOUND).toBe('PAYMENT_NOT_FOUND');
    });
    it('PAYMENT_CONFIG_NOT_FOUND is stable', () => {
      expect(sharedErrorCodes.PAYMENT_CONFIG_NOT_FOUND).toBe('PAYMENT_CONFIG_NOT_FOUND');
    });
    it('PAYMENT_PRICE_NOT_FOUND is stable', () => {
      expect(sharedErrorCodes.PAYMENT_PRICE_NOT_FOUND).toBe('PAYMENT_PRICE_NOT_FOUND');
    });
    it('PAYMENT_PRODUCT_NOT_FOUND is stable', () => {
      expect(sharedErrorCodes.PAYMENT_PRODUCT_NOT_FOUND).toBe('PAYMENT_PRODUCT_NOT_FOUND');
    });
    it('PAYMENT_CHECKOUT_ALREADY_EXISTS is stable', () => {
      expect(sharedErrorCodes.PAYMENT_CHECKOUT_ALREADY_EXISTS).toBe(
        'PAYMENT_CHECKOUT_ALREADY_EXISTS'
      );
    });

    // Auth module — replaced user and OAuth config generic errors
    it('AUTH_USER_NOT_FOUND is stable', () => {
      expect(sharedErrorCodes.AUTH_USER_NOT_FOUND).toBe('AUTH_USER_NOT_FOUND');
    });
    it('AUTH_OAUTH_CONFIG_NOT_FOUND is stable', () => {
      expect(sharedErrorCodes.AUTH_OAUTH_CONFIG_NOT_FOUND).toBe('AUTH_OAUTH_CONFIG_NOT_FOUND');
    });
    it('AUTH_OAUTH_CONFIG_ALREADY_EXISTS is stable', () => {
      expect(sharedErrorCodes.AUTH_OAUTH_CONFIG_ALREADY_EXISTS).toBe(
        'AUTH_OAUTH_CONFIG_ALREADY_EXISTS'
      );
    });

    // Database module — replaced generic migration duplicate errors
    it('DATABASE_MIGRATION_ALREADY_EXISTS is stable', () => {
      expect(sharedErrorCodes.DATABASE_MIGRATION_ALREADY_EXISTS).toBe(
        'DATABASE_MIGRATION_ALREADY_EXISTS'
      );
    });

    // Functions module — replaced generic NOT_FOUND / ALREADY_EXISTS
    it('FUNCTION_NOT_FOUND is stable', () => {
      expect(sharedErrorCodes.FUNCTION_NOT_FOUND).toBe('FUNCTION_NOT_FOUND');
    });
    it('FUNCTION_ALREADY_EXISTS is stable', () => {
      expect(sharedErrorCodes.FUNCTION_ALREADY_EXISTS).toBe('FUNCTION_ALREADY_EXISTS');
    });

    // Realtime module — replaced generic channel errors
    it('REALTIME_CHANNEL_NOT_FOUND is stable', () => {
      expect(sharedErrorCodes.REALTIME_CHANNEL_NOT_FOUND).toBe('REALTIME_CHANNEL_NOT_FOUND');
    });
    it('REALTIME_NOT_SUBSCRIBED is stable', () => {
      expect(sharedErrorCodes.REALTIME_NOT_SUBSCRIBED).toBe('REALTIME_NOT_SUBSCRIBED');
    });

    // Analytics module — replaced generic not-connected errors
    it('ANALYTICS_NOT_CONNECTED is stable', () => {
      expect(sharedErrorCodes.ANALYTICS_NOT_CONNECTED).toBe('ANALYTICS_NOT_CONNECTED');
    });

    // Docs module — replaced generic documentation lookup errors
    it('DOCS_NOT_FOUND is stable', () => {
      expect(sharedErrorCodes.DOCS_NOT_FOUND).toBe('DOCS_NOT_FOUND');
    });

    // General codes that remain in the schema for backward compatibility
    it('generic NOT_FOUND is preserved for backward compatibility', () => {
      expect(sharedErrorCodes.NOT_FOUND).toBe('NOT_FOUND');
    });
    it('generic ALREADY_EXISTS is preserved for backward compatibility', () => {
      expect(sharedErrorCodes.ALREADY_EXISTS).toBe('ALREADY_EXISTS');
    });
    it('generic INVALID_INPUT is preserved for backward compatibility', () => {
      expect(sharedErrorCodes.INVALID_INPUT).toBe('INVALID_INPUT');
    });
    it('INTERNAL_ERROR is stable', () => {
      expect(sharedErrorCodes.INTERNAL_ERROR).toBe('INTERNAL_ERROR');
    });
  });
});
