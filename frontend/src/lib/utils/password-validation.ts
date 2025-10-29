import { z } from 'zod';
import { PublicEmailAuthConfig } from '@insforge/shared-schemas';

/**
 * Creates a dynamic password schema based on email auth configuration
 */
export function createDynamicPasswordSchema(config: PublicEmailAuthConfig) {
  let schema = z.string();

  // Apply minimum length
  if (config.passwordMinLength) {
    schema = schema.min(
      config.passwordMinLength,
      `Password must be at least ${config.passwordMinLength} characters`
    );
  }

  // Apply uppercase requirement
  if (config.requireUppercase) {
    schema = schema.regex(/[A-Z]/, 'Password must contain at least 1 uppercase letter');
  }

  // Apply lowercase requirement
  if (config.requireLowercase) {
    schema = schema.regex(/[a-z]/, 'Password must contain at least 1 lowercase letter');
  }

  // Apply number requirement
  if (config.requireNumber) {
    schema = schema.regex(/\d/, 'Password must contain at least 1 number');
  }

  // Apply special character requirement
  if (config.requireSpecialChar) {
    schema = schema.regex(
      /[!@#$%^&*()_+\-=[\]{};':"\\|,.<>/?]/,
      'Password must contain at least 1 special character'
    );
  }

  return schema;
}

export interface PasswordRequirement {
  label: string;
  test: (password: string) => boolean;
  enabled: boolean;
}

/**
 * Generates password requirements array based on email auth configuration
 */
export function getPasswordRequirements(config: PublicEmailAuthConfig): PasswordRequirement[] {
  const requirements: PasswordRequirement[] = [];

  if (config.requireUppercase) {
    requirements.push({
      label: 'At least 1 Uppercase letter',
      test: (pwd) => /[A-Z]/.test(pwd),
      enabled: true,
    });
  }

  if (config.requireLowercase) {
    requirements.push({
      label: 'At least 1 Lowercase letter',
      test: (pwd) => /[a-z]/.test(pwd),
      enabled: true,
    });
  }

  if (config.requireNumber) {
    requirements.push({
      label: 'At least 1 Number',
      test: (pwd) => /\d/.test(pwd),
      enabled: true,
    });
  }

  if (config.requireSpecialChar) {
    requirements.push({
      label: 'Special character (e.g. !?<>@#$%)',
      test: (pwd) => /[!@#$%^&*()_+\-=[\]{};':"\\|,.<>/?]/.test(pwd),
      enabled: true,
    });
  }

  // Always show minimum length requirement
  requirements.push({
    label: `${config.passwordMinLength || 6} characters or more`,
    test: (pwd) => pwd.length >= (config.passwordMinLength || 6),
    enabled: true,
  });

  return requirements;
}

/**
 * Validates that a password meets all requirements
 */
export function validatePasswordAgainstConfig(
  password: string,
  config: PublicEmailAuthConfig
): boolean {
  if (!password) {
    return false;
  }
  const requirements = getPasswordRequirements(config);
  return requirements.every((req) => req.test(password));
}
