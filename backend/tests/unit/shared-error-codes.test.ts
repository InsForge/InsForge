import { describe, expect, it } from 'vitest';

import { ERROR_CODES as sharedErrorCodes } from '@insforge/shared-schemas';

describe('shared error codes', () => {
  /**
   * Full snapshot of the entire ERROR_CODES object.
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

    // Payments module — replaced INVALID_INPUT / NOT_FOUND
    it('PAYMENT_CONFIG_INVALID is stable', () => {
      expect(sharedErrorCodes.PAYMENT_CONFIG_INVALID).toBe('PAYMENT_CONFIG_INVALID');
    });
    it('PAYMENT_NOT_FOUND is stable', () => {
      expect(sharedErrorCodes.PAYMENT_NOT_FOUND).toBe('PAYMENT_NOT_FOUND');
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
