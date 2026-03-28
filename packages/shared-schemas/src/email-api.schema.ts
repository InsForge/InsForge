import { z } from 'zod';
import { emailSchema } from './auth.schema';

const emailOrEmails = z.union([
  emailSchema,
  z
    .array(emailSchema)
    .min(1, 'At least one email is required')
    .max(50, 'Maximum 50 recipients allowed'),
]);

export const sendRawEmailRequestSchema = z.object({
  to: emailOrEmails,
  subject: z.string().trim().min(1, 'Subject is required').max(500, 'Subject too long'),
  html: z.string().trim().min(1, 'HTML content is required'),
  cc: emailOrEmails.optional(),
  bcc: emailOrEmails.optional(),
  from: z.string().trim().max(100, 'From name too long').optional(),
  replyTo: z.string().email('Reply-To must be a valid email').optional(),
});

export type SendRawEmailRequest = z.infer<typeof sendRawEmailRequestSchema>;

/**
 * Response for POST /api/email/send-raw
 * Empty on success - extend with optional fields later if needed
 */
export const sendEmailResponseSchema = z.object({});

export type SendEmailResponse = z.infer<typeof sendEmailResponseSchema>;
