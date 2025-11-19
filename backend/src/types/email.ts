/**
 * Email template types supported by email providers
 */
export type EmailTemplate =
  | 'email-verification-code' // Numeric OTP for email verification
  | 'email-verification-link' // Magic link for email verification
  | 'reset-password-code' // Numeric OTP for password reset
  | 'reset-password-link'; // Magic link for password reset
