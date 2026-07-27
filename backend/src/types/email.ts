/**
 * Email template types supported by email providers
 */
export const EMAIL_TEMPLATE_TYPES = [
  'email-verification-code',
  'email-verification-link',
  'reset-password-code',
  'reset-password-link',
] as const;

export type EmailTemplate = (typeof EMAIL_TEMPLATE_TYPES)[number];
