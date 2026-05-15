import { describe, expect, it } from 'vitest';

import { ERROR_CODES as sharedErrorCodes } from '@insforge/shared-schemas';
import { ERROR_CODES as backendErrorCodes } from '@insforge/shared-schemas';

describe('shared error codes', () => {
  it('exports the canonical shared object and preserves stable string values', () => {
    expect(sharedErrorCodes).toBe(backendErrorCodes);
    expect(sharedErrorCodes.COMPUTE_QUOTA_EXCEEDED).toBe('COMPUTE_QUOTA_EXCEEDED');
    expect(sharedErrorCodes.SCHEDULE_INVALID_CRON).toBe('SCHEDULE_INVALID_CRON');
    expect(sharedErrorCodes.SECRET_NOT_FOUND).toBe('SECRET_NOT_FOUND');
    expect(sharedErrorCodes.DEPLOYMENT_ALREADY_EXISTS).toBe('DEPLOYMENT_ALREADY_EXISTS');
    expect(sharedErrorCodes.PAYMENT_METHOD_DECLINED).toBe('PAYMENT_METHOD_DECLINED');
  });
});