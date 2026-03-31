# Custom SMTP & Email Templates Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Allow project admins to configure custom SMTP servers and edit email templates via the Auth Settings UI, replacing the default InsForge cloud email provider.

**Architecture:** New `SmtpEmailProvider` implementing the existing `EmailProvider` interface, with config and templates stored in PostgreSQL. `EmailService` checks DB config per-call to route through SMTP or cloud. Frontend adds an "Email" tab to the Auth Settings dialog with two cards: SMTP settings and template editor.

**Tech Stack:** nodemailer, PostgreSQL, React + react-hook-form, Zod, existing InsForge patterns (singleton services, EncryptionManager, verifyAdmin middleware)

**Spec:** `docs/superpowers/specs/2026-03-16-custom-smtp-design.md`

---

## File Map

### New Files

| File | Purpose |
|------|---------|
| `backend/src/infra/database/migrations/024_create-smtp-config-and-email-templates.sql` | Migration: smtp_configs + email_templates tables + seed defaults |
| `backend/src/providers/email/smtp.provider.ts` | SmtpEmailProvider implementing EmailProvider interface |
| `backend/src/services/email/smtp-config.service.ts` | CRUD service for SMTP config (singleton) |
| `backend/src/services/email/email-template.service.ts` | CRUD service for email templates (singleton) |
| `frontend/src/features/auth/services/smtp-config.service.ts` | Frontend API client for SMTP config |
| `frontend/src/features/auth/services/email-template.service.ts` | Frontend API client for email templates |
| `frontend/src/features/auth/hooks/useSmtpConfig.ts` | React Query hook for SMTP config |
| `frontend/src/features/auth/hooks/useEmailTemplates.ts` | React Query hook for email templates |
| `frontend/src/features/auth/components/SmtpSettingsCard.tsx` | SMTP config form card component |
| `frontend/src/features/auth/components/EmailTemplateCard.tsx` | Email template editor card component |

### Modified Files

| File | Change |
|------|--------|
| `shared-schemas/src/auth.schema.ts` | Add `smtpConfigSchema`, `emailTemplateSchema` |
| `shared-schemas/src/auth-api.schema.ts` | Add request/response schemas + type exports |
| `backend/src/types/error-constants.ts` | Add SMTP error codes |
| `backend/src/services/email/email.service.ts` | Route sends through SMTP when configured |
| `backend/src/api/routes/auth/index.routes.ts` | Add SMTP config + template CRUD routes |
| `frontend/src/features/auth/components/AuthSettingsMenuDialog.tsx` | Add "Email" tab with SMTP + template cards |
| `package.json` (backend workspace) | Add `nodemailer` + `@types/nodemailer` |

---

## Task 1: Install nodemailer dependency

**Files:**
- Modify: `backend/package.json`

- [ ] **Step 1: Install nodemailer**

```bash
cd /Users/gary/projects/insforge-repo/InsForge/backend
npm install nodemailer
npm install -D @types/nodemailer
```

- [ ] **Step 2: Verify installation**

```bash
cd /Users/gary/projects/insforge-repo/InsForge/backend
node -e "require('nodemailer')"
```

Expected: No error output

- [ ] **Step 3: Commit**

```bash
cd /Users/gary/projects/insforge-repo/InsForge
git add backend/package.json backend/package-lock.json
git commit -m "chore: add nodemailer dependency for custom SMTP support"
```

---

## Task 2: Database migration — SMTP config and email templates tables

**Files:**
- Create: `backend/src/infra/database/migrations/024_create-smtp-config-and-email-templates.sql`

- [ ] **Step 1: Write the migration file**

```sql
-- Migration: Create SMTP configuration and email templates tables
-- These tables support custom SMTP email delivery as an alternative to InsForge cloud

-- ============================================================================
-- SMTP Configuration (singleton)
-- ============================================================================

CREATE TABLE IF NOT EXISTS auth.smtp_configs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  enabled BOOLEAN NOT NULL DEFAULT FALSE,
  host TEXT NOT NULL DEFAULT '',
  port INTEGER NOT NULL DEFAULT 465,
  username TEXT NOT NULL DEFAULT '',
  password_encrypted TEXT NOT NULL DEFAULT '',
  sender_email TEXT NOT NULL DEFAULT '',
  sender_name TEXT NOT NULL DEFAULT '',
  min_interval_seconds INTEGER NOT NULL DEFAULT 60,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Singleton constraint: only one row allowed
CREATE UNIQUE INDEX IF NOT EXISTS smtp_configs_singleton_idx ON auth.smtp_configs ((1));

-- Insert default row (disabled)
INSERT INTO auth.smtp_configs (enabled)
VALUES (FALSE)
ON CONFLICT DO NOTHING;

-- ============================================================================
-- Email Templates
-- ============================================================================

CREATE TABLE IF NOT EXISTS auth.email_templates (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  template_type TEXT NOT NULL,
  subject TEXT NOT NULL,
  body_html TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT email_templates_type_unique UNIQUE (template_type)
);

-- Seed default templates
INSERT INTO auth.email_templates (template_type, subject, body_html) VALUES
(
  'email-verification-code',
  'Verify your email',
  '<!DOCTYPE html><html><head><meta charset="utf-8"></head><body style="font-family:-apple-system,BlinkMacSystemFont,''Segoe UI'',Roboto,sans-serif;max-width:600px;margin:0 auto;padding:40px 20px;color:#1a1a1a;"><div style="text-align:center;padding:32px;background:#f9fafb;border-radius:12px;border:1px solid #e5e7eb;"><h2 style="margin:0 0 8px;font-size:20px;font-weight:600;">Verify your email</h2><p style="margin:0 0 24px;color:#6b7280;font-size:14px;">Enter this code to verify your email address</p><div style="background:#ffffff;border:2px solid #e5e7eb;border-radius:8px;padding:16px 32px;display:inline-block;margin-bottom:24px;"><span style="font-size:32px;font-weight:700;letter-spacing:8px;color:#111827;">{{ code }}</span></div><p style="margin:0;color:#9ca3af;font-size:12px;">This code expires in 15 minutes</p></div></body></html>'
),
(
  'email-verification-link',
  'Verify your email',
  '<!DOCTYPE html><html><head><meta charset="utf-8"></head><body style="font-family:-apple-system,BlinkMacSystemFont,''Segoe UI'',Roboto,sans-serif;max-width:600px;margin:0 auto;padding:40px 20px;color:#1a1a1a;"><div style="text-align:center;padding:32px;background:#f9fafb;border-radius:12px;border:1px solid #e5e7eb;"><h2 style="margin:0 0 8px;font-size:20px;font-weight:600;">Verify your email</h2><p style="margin:0 0 24px;color:#6b7280;font-size:14px;">Click the button below to verify your email address</p><a href="{{ link }}" style="display:inline-block;background:#111827;color:#ffffff;text-decoration:none;padding:12px 32px;border-radius:6px;font-size:14px;font-weight:500;">Verify Email</a><p style="margin:24px 0 0;color:#9ca3af;font-size:12px;">This link expires in 24 hours</p></div></body></html>'
),
(
  'reset-password-code',
  'Reset your password',
  '<!DOCTYPE html><html><head><meta charset="utf-8"></head><body style="font-family:-apple-system,BlinkMacSystemFont,''Segoe UI'',Roboto,sans-serif;max-width:600px;margin:0 auto;padding:40px 20px;color:#1a1a1a;"><div style="text-align:center;padding:32px;background:#f9fafb;border-radius:12px;border:1px solid #e5e7eb;"><h2 style="margin:0 0 8px;font-size:20px;font-weight:600;">Reset your password</h2><p style="margin:0 0 24px;color:#6b7280;font-size:14px;">Enter this code to reset your password</p><div style="background:#ffffff;border:2px solid #e5e7eb;border-radius:8px;padding:16px 32px;display:inline-block;margin-bottom:24px;"><span style="font-size:32px;font-weight:700;letter-spacing:8px;color:#111827;">{{ code }}</span></div><p style="margin:0;color:#9ca3af;font-size:12px;">This code expires in 15 minutes</p></div></body></html>'
),
(
  'reset-password-link',
  'Reset your password',
  '<!DOCTYPE html><html><head><meta charset="utf-8"></head><body style="font-family:-apple-system,BlinkMacSystemFont,''Segoe UI'',Roboto,sans-serif;max-width:600px;margin:0 auto;padding:40px 20px;color:#1a1a1a;"><div style="text-align:center;padding:32px;background:#f9fafb;border-radius:12px;border:1px solid #e5e7eb;"><h2 style="margin:0 0 8px;font-size:20px;font-weight:600;">Reset your password</h2><p style="margin:0 0 24px;color:#6b7280;font-size:14px;">Click the button below to reset your password</p><a href="{{ link }}" style="display:inline-block;background:#111827;color:#ffffff;text-decoration:none;padding:12px 32px;border-radius:6px;font-size:14px;font-weight:500;">Reset Password</a><p style="margin:24px 0 0;color:#9ca3af;font-size:12px;">This link expires in 24 hours</p></div></body></html>'
)
ON CONFLICT (template_type) DO NOTHING;
```

- [ ] **Step 2: Verify migration number is correct**

```bash
ls /Users/gary/projects/insforge-repo/InsForge/backend/src/infra/database/migrations/ | tail -3
```

Expected: `024_create-smtp-config-and-email-templates.sql` follows `023_ai-configs-soft-delete.sql`

- [ ] **Step 3: Commit**

```bash
cd /Users/gary/projects/insforge-repo/InsForge
git add backend/src/infra/database/migrations/024_create-smtp-config-and-email-templates.sql
git commit -m "feat(database): add smtp_configs and email_templates tables"
```

---

## Task 3: Shared schemas — SMTP config and email template Zod schemas

**Files:**
- Modify: `shared-schemas/src/auth.schema.ts` (add after `authConfigSchema` at line 110)
- Modify: `shared-schemas/src/auth-api.schema.ts` (add request/response schemas + type exports)

- [ ] **Step 1: Add entity schemas to `auth.schema.ts`**

Add after `authConfigSchema` (line 110), before the token payload schema:

```typescript
// SMTP configuration schema
export const smtpConfigSchema = z.object({
  id: z.string().uuid(),
  enabled: z.boolean(),
  host: z.string(),
  port: z.number().int().min(1).max(65535),
  username: z.string(),
  hasPassword: z.boolean(), // Never expose actual password
  senderEmail: z.string(),
  senderName: z.string(),
  minIntervalSeconds: z.number().int().min(0),
  createdAt: z.string(),
  updatedAt: z.string(),
});

// Email template schema
export const emailTemplateSchema = z.object({
  id: z.string().uuid(),
  templateType: z.string(),
  subject: z.string(),
  bodyHtml: z.string(),
  createdAt: z.string(),
  updatedAt: z.string(),
});
```

Add type exports at the end of the type exports section:

```typescript
export type SmtpConfigSchema = z.infer<typeof smtpConfigSchema>;
export type EmailTemplateSchema = z.infer<typeof emailTemplateSchema>;
```

- [ ] **Step 2: Add API schemas to `auth-api.schema.ts`**

Add a new section before the error response schema section (before line 376):

```typescript
// ============================================================================
// SMTP Configuration schemas
// ============================================================================

/**
 * PUT /api/auth/smtp-config - Upsert SMTP configuration
 */
export const upsertSmtpConfigRequestSchema = z.object({
  enabled: z.boolean(),
  host: z.string().min(1, 'SMTP host is required'),
  port: z.number().int().min(1).max(65535),
  username: z.string().min(1, 'SMTP username is required'),
  password: z.string().min(1, 'SMTP password is required').optional(),
  senderEmail: z.string().email('Invalid sender email'),
  senderName: z.string().min(1, 'Sender name is required'),
  minIntervalSeconds: z.number().int().min(0).default(60),
});

/**
 * Response for GET /api/auth/smtp-config
 */
export const getSmtpConfigResponseSchema = smtpConfigSchema;

// ============================================================================
// Email Template schemas
// ============================================================================

/**
 * PUT /api/auth/email-templates/:type - Update email template
 */
export const updateEmailTemplateRequestSchema = z.object({
  subject: z.string().min(1, 'Subject is required'),
  bodyHtml: z.string().min(1, 'Template body is required'),
});

/**
 * Response for GET /api/auth/email-templates
 */
export const listEmailTemplatesResponseSchema = z.object({
  data: z.array(emailTemplateSchema),
});
```

Import `smtpConfigSchema` and `emailTemplateSchema` at the top of `auth-api.schema.ts` (line 11):

```typescript
import {
  emailSchema,
  passwordSchema,
  nameSchema,
  userIdSchema,
  userSchema,
  profileSchema,
  oAuthConfigSchema,
  oAuthProvidersSchema,
  authConfigSchema,
  smtpConfigSchema,
  emailTemplateSchema,
} from './auth.schema';
```

Add type exports at the end of the type exports section:

```typescript
export type UpsertSmtpConfigRequest = z.infer<typeof upsertSmtpConfigRequestSchema>;
export type GetSmtpConfigResponse = z.infer<typeof getSmtpConfigResponseSchema>;
export type UpdateEmailTemplateRequest = z.infer<typeof updateEmailTemplateRequestSchema>;
export type ListEmailTemplatesResponse = z.infer<typeof listEmailTemplatesResponseSchema>;
```

- [ ] **Step 3: Verify shared-schemas compile**

```bash
cd /Users/gary/projects/insforge-repo/InsForge/shared-schemas
npx tsc --noEmit
```

Expected: No errors

- [ ] **Step 4: Commit**

```bash
cd /Users/gary/projects/insforge-repo/InsForge
git add shared-schemas/src/auth.schema.ts shared-schemas/src/auth-api.schema.ts
git commit -m "feat(schemas): add SMTP config and email template Zod schemas"
```

---

## Task 4: Backend — Error constants and email type updates

**Files:**
- Modify: `backend/src/types/error-constants.ts`

- [ ] **Step 1: Add SMTP error codes to `error-constants.ts`**

Add these entries inside the `ERROR_CODES` enum:

```typescript
  EMAIL_SMTP_CONNECTION_FAILED = 'EMAIL_SMTP_CONNECTION_FAILED',
  EMAIL_SMTP_SEND_FAILED = 'EMAIL_SMTP_SEND_FAILED',
  EMAIL_TEMPLATE_NOT_FOUND = 'EMAIL_TEMPLATE_NOT_FOUND',
```

- [ ] **Step 2: Commit**

```bash
cd /Users/gary/projects/insforge-repo/InsForge
git add backend/src/types/error-constants.ts
git commit -m "feat(types): add SMTP error codes and email template record type"
```

---

## Task 5: Backend — SMTP Config Service

**Files:**
- Create: `backend/src/services/email/smtp-config.service.ts`

- [ ] **Step 1: Write the SMTP Config Service**

```typescript
import { Pool } from 'pg';
import nodemailer from 'nodemailer';
import { DatabaseManager } from '@/infra/database/database.manager.js';
import { EncryptionManager } from '@/infra/security/encryption.manager.js';
import { AppError } from '@/api/middlewares/error.js';
import { ERROR_CODES } from '@/types/error-constants.js';
import logger from '@/utils/logger.js';
import type { SmtpConfigSchema, UpsertSmtpConfigRequest } from '@insforge/shared-schemas';

export class SmtpConfigService {
  private static instance: SmtpConfigService;
  private pool: Pool | null = null;

  private constructor() {
    logger.info('SmtpConfigService initialized');
  }

  public static getInstance(): SmtpConfigService {
    if (!SmtpConfigService.instance) {
      SmtpConfigService.instance = new SmtpConfigService();
    }
    return SmtpConfigService.instance;
  }

  private getPool(): Pool {
    if (!this.pool) {
      this.pool = DatabaseManager.getInstance().getPool();
    }
    return this.pool;
  }

  /**
   * Get SMTP configuration (password masked)
   */
  async getSmtpConfig(): Promise<SmtpConfigSchema> {
    try {
      const result = await this.getPool().query(
        `SELECT
          id,
          enabled,
          host,
          port,
          username,
          password_encrypted IS NOT NULL AND password_encrypted != '' as "hasPassword",
          sender_email as "senderEmail",
          sender_name as "senderName",
          min_interval_seconds as "minIntervalSeconds",
          created_at as "createdAt",
          updated_at as "updatedAt"
         FROM auth.smtp_configs
         LIMIT 1`
      );

      if (!result.rows.length) {
        return {
          id: '00000000-0000-0000-0000-000000000000',
          enabled: false,
          host: '',
          port: 465,
          username: '',
          hasPassword: false,
          senderEmail: '',
          senderName: '',
          minIntervalSeconds: 60,
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        };
      }

      return result.rows[0];
    } catch (error) {
      logger.error('Failed to get SMTP config', { error });
      throw new AppError('Failed to get SMTP configuration', 500, ERROR_CODES.INTERNAL_ERROR);
    }
  }

  /**
   * Get raw SMTP config with decrypted password (for internal use by SmtpEmailProvider)
   */
  async getRawSmtpConfig(): Promise<{
    enabled: boolean;
    host: string;
    port: number;
    username: string;
    password: string;
    senderEmail: string;
    senderName: string;
    minIntervalSeconds: number;
  } | null> {
    try {
      const result = await this.getPool().query(
        `SELECT
          enabled,
          host,
          port,
          username,
          password_encrypted as "passwordEncrypted",
          sender_email as "senderEmail",
          sender_name as "senderName",
          min_interval_seconds as "minIntervalSeconds"
         FROM auth.smtp_configs
         LIMIT 1`
      );

      if (!result.rows.length || !result.rows[0].enabled) {
        return null;
      }

      const row = result.rows[0];
      return {
        enabled: row.enabled,
        host: row.host,
        port: row.port,
        username: row.username,
        password: row.passwordEncrypted ? EncryptionManager.decrypt(row.passwordEncrypted) : '',
        senderEmail: row.senderEmail,
        senderName: row.senderName,
        minIntervalSeconds: row.minIntervalSeconds,
      };
    } catch (error) {
      logger.error('Failed to get raw SMTP config', { error });
      return null;
    }
  }

  /**
   * Get decrypted password from existing config (for SMTP verification when password not re-submitted)
   */
  private async getDecryptedPassword(): Promise<string> {
    const result = await this.getPool().query(
      `SELECT password_encrypted FROM auth.smtp_configs LIMIT 1`
    );
    if (!result.rows.length || !result.rows[0].password_encrypted) return '';
    return EncryptionManager.decrypt(result.rows[0].password_encrypted);
  }

  /**
   * Upsert SMTP configuration
   */
  async upsertSmtpConfig(input: UpsertSmtpConfigRequest): Promise<SmtpConfigSchema> {
    const client = await this.getPool().connect();
    try {
      await client.query('BEGIN');

      const existingResult = await client.query('SELECT id FROM auth.smtp_configs LIMIT 1 FOR UPDATE');

      // Validate SMTP connection before persisting
      if (input.enabled) {
        const testPassword = input.password
          || (existingResult.rows.length
            ? await this.getDecryptedPassword()
            : '');

        const transporter = nodemailer.createTransport({
          host: input.host,
          port: input.port,
          secure: input.port === 465,
          auth: {
            user: input.username,
            pass: testPassword,
          },
        });

        try {
          await transporter.verify();
        } catch (verifyError) {
          await client.query('ROLLBACK');
          throw new AppError(
            `SMTP connection failed: ${verifyError instanceof Error ? verifyError.message : 'Unknown error'}`,
            400,
            ERROR_CODES.EMAIL_SMTP_CONNECTION_FAILED
          );
        }
      }

      const encryptedPassword = input.password
        ? EncryptionManager.encrypt(input.password)
        : undefined;

      let result;

      if (existingResult.rows.length) {
        // Update existing
        const updates: string[] = [];
        const values: (string | number | boolean)[] = [];
        let paramCount = 1;

        updates.push(`enabled = $${paramCount++}`);
        values.push(input.enabled);

        updates.push(`host = $${paramCount++}`);
        values.push(input.host);

        updates.push(`port = $${paramCount++}`);
        values.push(input.port);

        updates.push(`username = $${paramCount++}`);
        values.push(input.username);

        if (encryptedPassword) {
          updates.push(`password_encrypted = $${paramCount++}`);
          values.push(encryptedPassword);
        }

        updates.push(`sender_email = $${paramCount++}`);
        values.push(input.senderEmail);

        updates.push(`sender_name = $${paramCount++}`);
        values.push(input.senderName);

        updates.push(`min_interval_seconds = $${paramCount++}`);
        values.push(input.minIntervalSeconds ?? 60);

        updates.push('updated_at = NOW()');

        result = await client.query(
          `UPDATE auth.smtp_configs
           SET ${updates.join(', ')}
           RETURNING
             id,
             enabled,
             host,
             port,
             username,
             password_encrypted IS NOT NULL AND password_encrypted != '' as "hasPassword",
             sender_email as "senderEmail",
             sender_name as "senderName",
             min_interval_seconds as "minIntervalSeconds",
             created_at as "createdAt",
             updated_at as "updatedAt"`,
          values
        );
      } else {
        // Insert new
        result = await client.query(
          `INSERT INTO auth.smtp_configs (enabled, host, port, username, password_encrypted, sender_email, sender_name, min_interval_seconds)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
           RETURNING
             id,
             enabled,
             host,
             port,
             username,
             password_encrypted IS NOT NULL AND password_encrypted != '' as "hasPassword",
             sender_email as "senderEmail",
             sender_name as "senderName",
             min_interval_seconds as "minIntervalSeconds",
             created_at as "createdAt",
             updated_at as "updatedAt"`,
          [
            input.enabled,
            input.host,
            input.port,
            input.username,
            encryptedPassword || '',
            input.senderEmail,
            input.senderName,
            input.minIntervalSeconds ?? 60,
          ]
        );
      }

      await client.query('COMMIT');
      logger.info('SMTP config updated', { enabled: input.enabled });
      return result.rows[0];
    } catch (error) {
      await client.query('ROLLBACK');
      logger.error('Failed to upsert SMTP config', { error });
      if (error instanceof AppError) throw error;
      throw new AppError('Failed to update SMTP configuration', 500, ERROR_CODES.INTERNAL_ERROR);
    } finally {
      client.release();
    }
  }
}
```

- [ ] **Step 2: Verify it compiles**

```bash
cd /Users/gary/projects/insforge-repo/InsForge/backend
npx tsc --noEmit
```

Expected: No errors related to smtp-config.service

- [ ] **Step 3: Commit**

```bash
cd /Users/gary/projects/insforge-repo/InsForge
git add backend/src/services/email/smtp-config.service.ts
git commit -m "feat(email): add SMTP config service with encrypted password storage"
```

---

## Task 6: Backend — Email Template Service

**Files:**
- Create: `backend/src/services/email/email-template.service.ts`

- [ ] **Step 1: Write the Email Template Service**

```typescript
import { Pool } from 'pg';
import { DatabaseManager } from '@/infra/database/database.manager.js';
import { AppError } from '@/api/middlewares/error.js';
import { ERROR_CODES } from '@/types/error-constants.js';
import logger from '@/utils/logger.js';
import type { EmailTemplate } from '@/types/email.js';
import type { EmailTemplateSchema, UpdateEmailTemplateRequest } from '@insforge/shared-schemas';

export class EmailTemplateService {
  private static instance: EmailTemplateService;
  private pool: Pool | null = null;

  private constructor() {
    logger.info('EmailTemplateService initialized');
  }

  public static getInstance(): EmailTemplateService {
    if (!EmailTemplateService.instance) {
      EmailTemplateService.instance = new EmailTemplateService();
    }
    return EmailTemplateService.instance;
  }

  private getPool(): Pool {
    if (!this.pool) {
      this.pool = DatabaseManager.getInstance().getPool();
    }
    return this.pool;
  }

  /**
   * Get all email templates
   */
  async getTemplates(): Promise<EmailTemplateSchema[]> {
    try {
      const result = await this.getPool().query(
        `SELECT
          id,
          template_type as "templateType",
          subject,
          body_html as "bodyHtml",
          created_at as "createdAt",
          updated_at as "updatedAt"
         FROM auth.email_templates
         ORDER BY template_type`
      );
      return result.rows;
    } catch (error) {
      logger.error('Failed to get email templates', { error });
      throw new AppError('Failed to get email templates', 500, ERROR_CODES.INTERNAL_ERROR);
    }
  }

  /**
   * Get a single email template by type
   */
  async getTemplate(templateType: EmailTemplate): Promise<EmailTemplateSchema> {
    try {
      const result = await this.getPool().query(
        `SELECT
          id,
          template_type as "templateType",
          subject,
          body_html as "bodyHtml",
          created_at as "createdAt",
          updated_at as "updatedAt"
         FROM auth.email_templates
         WHERE template_type = $1`,
        [templateType]
      );

      if (!result.rows.length) {
        throw new AppError(
          `Email template not found: ${templateType}`,
          404,
          ERROR_CODES.EMAIL_TEMPLATE_NOT_FOUND
        );
      }

      return result.rows[0];
    } catch (error) {
      if (error instanceof AppError) throw error;
      logger.error('Failed to get email template', { templateType, error });
      throw new AppError('Failed to get email template', 500, ERROR_CODES.INTERNAL_ERROR);
    }
  }

  /**
   * Update an email template
   */
  async updateTemplate(
    templateType: EmailTemplate,
    input: UpdateEmailTemplateRequest
  ): Promise<EmailTemplateSchema> {
    try {
      const result = await this.getPool().query(
        `UPDATE auth.email_templates
         SET subject = $1, body_html = $2, updated_at = NOW()
         WHERE template_type = $3
         RETURNING
           id,
           template_type as "templateType",
           subject,
           body_html as "bodyHtml",
           created_at as "createdAt",
           updated_at as "updatedAt"`,
        [input.subject, input.bodyHtml, templateType]
      );

      if (!result.rows.length) {
        throw new AppError(
          `Email template not found: ${templateType}`,
          404,
          ERROR_CODES.EMAIL_TEMPLATE_NOT_FOUND
        );
      }

      logger.info('Email template updated', { templateType });
      return result.rows[0];
    } catch (error) {
      if (error instanceof AppError) throw error;
      logger.error('Failed to update email template', { templateType, error });
      throw new AppError('Failed to update email template', 500, ERROR_CODES.INTERNAL_ERROR);
    }
  }
}
```

- [ ] **Step 2: Verify it compiles**

```bash
cd /Users/gary/projects/insforge-repo/InsForge/backend
npx tsc --noEmit
```

- [ ] **Step 3: Commit**

```bash
cd /Users/gary/projects/insforge-repo/InsForge
git add backend/src/services/email/email-template.service.ts
git commit -m "feat(email): add email template CRUD service"
```

---

## Task 7: Backend — SMTP Email Provider

**Files:**
- Create: `backend/src/providers/email/smtp.provider.ts`

- [ ] **Step 1: Write the SMTP Email Provider**

```typescript
import nodemailer from 'nodemailer';
import type { Transporter } from 'nodemailer';
import { EmailProvider } from './base.provider.js';
import { SmtpConfigService } from '@/services/email/smtp-config.service.js';
import { EmailTemplateService } from '@/services/email/email-template.service.js';
import { AppError } from '@/api/middlewares/error.js';
import { ERROR_CODES } from '@/types/error-constants.js';
import logger from '@/utils/logger.js';
import type { EmailTemplate } from '@/types/email.js';
import type { SendRawEmailRequest } from '@insforge/shared-schemas';

/**
 * HTML-escape a string to prevent XSS in email templates
 */
function escapeHtml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/**
 * SMTP email provider using nodemailer
 */
export class SmtpEmailProvider implements EmailProvider {
  private smtpConfigService = SmtpConfigService.getInstance();
  private emailTemplateService = EmailTemplateService.getInstance();

  supportsTemplates(): boolean {
    return true;
  }

  /**
   * Create a nodemailer transporter from DB config
   */
  private async createTransporter(): Promise<{ transporter: Transporter; senderEmail: string; senderName: string }> {
    const config = await this.smtpConfigService.getRawSmtpConfig();

    if (!config) {
      throw new AppError(
        'SMTP is not configured or not enabled',
        500,
        ERROR_CODES.EMAIL_SMTP_CONNECTION_FAILED
      );
    }

    const transporter = nodemailer.createTransport({
      host: config.host,
      port: config.port,
      secure: config.port === 465,
      auth: {
        user: config.username,
        pass: config.password,
      },
    });

    return {
      transporter,
      senderEmail: config.senderEmail,
      senderName: config.senderName,
    };
  }

  /**
   * Render a template by replacing placeholders with values
   */
  private renderTemplate(
    html: string,
    variables: Record<string, string>
  ): string {
    let rendered = html;
    for (const [key, value] of Object.entries(variables)) {
      // Don't escape 'link' values — they are URLs used in href attributes
      const safeValue = key === 'link' ? value : escapeHtml(value);
      rendered = rendered.replace(new RegExp(`\\{\\{\\s*${key}\\s*\\}\\}`, 'g'), safeValue);
    }
    return rendered;
  }

  async sendWithTemplate(
    email: string,
    name: string,
    template: EmailTemplate,
    variables?: Record<string, string>
  ): Promise<void> {
    try {
      const { transporter, senderEmail, senderName } = await this.createTransporter();
      const templateRecord = await this.emailTemplateService.getTemplate(template);

      const renderedSubject = this.renderTemplate(
        templateRecord.subject,
        { ...variables, email, app_name: name }
      );
      const renderedBody = this.renderTemplate(
        templateRecord.bodyHtml,
        { ...variables, email, app_name: name }
      );

      await transporter.sendMail({
        from: `"${senderName}" <${senderEmail}>`,
        to: email,
        subject: renderedSubject,
        html: renderedBody,
      });

      logger.info('Email sent via SMTP', { template, to: email });
    } catch (error) {
      if (error instanceof AppError) throw error;
      logger.error('Failed to send email via SMTP', {
        template,
        to: email,
        error: error instanceof Error ? error.message : 'Unknown error',
      });
      throw new AppError(
        `Failed to send email via SMTP: ${error instanceof Error ? error.message : 'Unknown error'}`,
        500,
        ERROR_CODES.EMAIL_SMTP_SEND_FAILED
      );
    }
  }

  async sendRaw(options: SendRawEmailRequest): Promise<void> {
    try {
      const { transporter, senderEmail, senderName } = await this.createTransporter();

      await transporter.sendMail({
        from: `"${senderName}" <${senderEmail}>`,
        to: options.to,
        subject: options.subject,
        html: options.html,
        cc: options.cc,
        bcc: options.bcc,
        replyTo: options.replyTo,
      });

      logger.info('Raw email sent via SMTP', { to: options.to });
    } catch (error) {
      if (error instanceof AppError) throw error;
      logger.error('Failed to send raw email via SMTP', {
        to: options.to,
        error: error instanceof Error ? error.message : 'Unknown error',
      });
      throw new AppError(
        `Failed to send email via SMTP: ${error instanceof Error ? error.message : 'Unknown error'}`,
        500,
        ERROR_CODES.EMAIL_SMTP_SEND_FAILED
      );
    }
  }
}
```

- [ ] **Step 2: Verify it compiles**

```bash
cd /Users/gary/projects/insforge-repo/InsForge/backend
npx tsc --noEmit
```

- [ ] **Step 3: Commit**

```bash
cd /Users/gary/projects/insforge-repo/InsForge
git add backend/src/providers/email/smtp.provider.ts
git commit -m "feat(email): add SMTP email provider with nodemailer"
```

---

## Task 8: Backend — Modify EmailService to route through SMTP

**Files:**
- Modify: `backend/src/services/email/email.service.ts`

- [ ] **Step 1: Update EmailService to check SMTP config per-call**

Replace the entire file content with:

```typescript
import { EmailProvider } from '@/providers/email/base.provider.js';
import { CloudEmailProvider } from '@/providers/email/cloud.provider.js';
import { SmtpEmailProvider } from '@/providers/email/smtp.provider.js';
import { SmtpConfigService } from '@/services/email/smtp-config.service.js';
import { EmailTemplate } from '@/types/email.js';
import { SendRawEmailRequest } from '@insforge/shared-schemas';
import logger from '@/utils/logger.js';

/**
 * Email service that orchestrates different email providers
 */
export class EmailService {
  private static instance: EmailService;
  private cloudProvider: EmailProvider;
  private smtpProvider: EmailProvider;
  private smtpConfigService: SmtpConfigService;

  private constructor() {
    this.cloudProvider = new CloudEmailProvider();
    this.smtpProvider = new SmtpEmailProvider();
    this.smtpConfigService = SmtpConfigService.getInstance();
    logger.info('EmailService initialized with cloud + SMTP providers');
  }

  public static getInstance(): EmailService {
    if (!EmailService.instance) {
      EmailService.instance = new EmailService();
    }
    return EmailService.instance;
  }

  /**
   * Resolve which provider to use based on SMTP config
   */
  private async resolveProvider(): Promise<EmailProvider> {
    try {
      const config = await this.smtpConfigService.getRawSmtpConfig();
      if (config && config.enabled) {
        return this.smtpProvider;
      }
    } catch (error) {
      logger.warn('Failed to check SMTP config, falling back to cloud provider', { error });
    }
    return this.cloudProvider;
  }

  /**
   * Send email using predefined template
   */
  public async sendWithTemplate(
    email: string,
    name: string,
    template: EmailTemplate,
    variables?: Record<string, string>
  ): Promise<void> {
    const provider = await this.resolveProvider();
    return provider.sendWithTemplate(email, name, template, variables);
  }

  /**
   * Send custom/raw email
   */
  public async sendRaw(options: SendRawEmailRequest): Promise<void> {
    const provider = await this.resolveProvider();
    if (!provider.sendRaw) {
      throw new Error('Current email provider does not support raw email sending');
    }
    return provider.sendRaw(options);
  }

  /**
   * Check if current provider supports templates
   */
  public supportsTemplates(): boolean {
    return true;
  }
}
```

- [ ] **Step 2: Verify it compiles**

```bash
cd /Users/gary/projects/insforge-repo/InsForge/backend
npx tsc --noEmit
```

- [ ] **Step 3: Commit**

```bash
cd /Users/gary/projects/insforge-repo/InsForge
git add backend/src/services/email/email.service.ts
git commit -m "feat(email): route email sends through SMTP when configured"
```

---

## Task 9: Backend — API routes for SMTP config and email templates

**Files:**
- Modify: `backend/src/api/routes/auth/index.routes.ts`

- [ ] **Step 1: Add imports at the top of the file**

Add these imports alongside existing ones:

```typescript
import { SmtpConfigService } from '@/services/email/smtp-config.service.js';
import { EmailTemplateService } from '@/services/email/email-template.service.js';
import {
  upsertSmtpConfigRequestSchema,
  updateEmailTemplateRequestSchema,
} from '@insforge/shared-schemas';
import type { EmailTemplate } from '@/types/email.js';
```

Add service instances alongside existing ones (after `const auditService = ...`):

```typescript
const smtpConfigService = SmtpConfigService.getInstance();
const emailTemplateService = EmailTemplateService.getInstance();
```

- [ ] **Step 2: Add SMTP config routes**

Add before the `export default router;` line (line 874):

```typescript
// ============================================================================
// SMTP Configuration Routes
// ============================================================================

// GET /api/auth/smtp-config - Get SMTP configuration (admin only)
router.get('/smtp-config', verifyAdmin, async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const config = await smtpConfigService.getSmtpConfig();
    successResponse(res, config);
  } catch (error) {
    next(error);
  }
});

// PUT /api/auth/smtp-config - Update SMTP configuration (admin only)
router.put('/smtp-config', verifyAdmin, async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const validationResult = upsertSmtpConfigRequestSchema.safeParse(req.body);
    if (!validationResult.success) {
      throw new AppError(
        validationResult.error.issues.map(e => `${e.path.join('.')}: ${e.message}`).join(', '),
        400,
        ERROR_CODES.INVALID_INPUT
      );
    }

    const input = validationResult.data;
    const config = await smtpConfigService.upsertSmtpConfig(input);

    await auditService.log({
      actor: req.user?.email || 'api-key',
      action: 'UPDATE_SMTP_CONFIG',
      module: 'EMAIL',
      details: { enabled: input.enabled, host: input.host },
      ip_address: req.ip,
    });

    successResponse(res, config);
  } catch (error) {
    next(error);
  }
});

// ============================================================================
// Email Template Routes
// ============================================================================

// GET /api/auth/email-templates - Get all email templates (admin only)
router.get('/email-templates', verifyAdmin, async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const templates = await emailTemplateService.getTemplates();
    successResponse(res, { data: templates });
  } catch (error) {
    next(error);
  }
});

// PUT /api/auth/email-templates/:type - Update email template (admin only)
router.put('/email-templates/:type', verifyAdmin, async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const templateType = req.params.type as EmailTemplate;
    const validTypes: EmailTemplate[] = [
      'email-verification-code',
      'email-verification-link',
      'reset-password-code',
      'reset-password-link',
    ];

    if (!validTypes.includes(templateType)) {
      throw new AppError(
        `Invalid template type: ${templateType}`,
        400,
        ERROR_CODES.INVALID_INPUT
      );
    }

    const validationResult = updateEmailTemplateRequestSchema.safeParse(req.body);
    if (!validationResult.success) {
      throw new AppError(
        validationResult.error.issues.map(e => `${e.path.join('.')}: ${e.message}`).join(', '),
        400,
        ERROR_CODES.INVALID_INPUT
      );
    }

    const template = await emailTemplateService.updateTemplate(templateType, validationResult.data);

    await auditService.log({
      actor: req.user?.email || 'api-key',
      action: 'UPDATE_EMAIL_TEMPLATE',
      module: 'EMAIL',
      details: { templateType },
      ip_address: req.ip,
    });

    successResponse(res, template);
  } catch (error) {
    next(error);
  }
});
```

- [ ] **Step 3: Verify it compiles**

```bash
cd /Users/gary/projects/insforge-repo/InsForge/backend
npx tsc --noEmit
```

- [ ] **Step 4: Commit**

```bash
cd /Users/gary/projects/insforge-repo/InsForge
git add backend/src/api/routes/auth/index.routes.ts
git commit -m "feat(api): add SMTP config and email template CRUD routes"
```

---

## Task 10: Frontend — SMTP Config API service and hook

**Files:**
- Create: `frontend/src/features/auth/services/smtp-config.service.ts`
- Create: `frontend/src/features/auth/hooks/useSmtpConfig.ts`

- [ ] **Step 1: Write the SMTP config API service**

```typescript
import { apiClient } from '@/lib/api/client';
import type { SmtpConfigSchema, UpsertSmtpConfigRequest } from '@insforge/shared-schemas';

export class SmtpConfigService {
  async getConfig(): Promise<SmtpConfigSchema> {
    return apiClient.request('/auth/smtp-config');
  }

  async updateConfig(config: UpsertSmtpConfigRequest): Promise<SmtpConfigSchema> {
    return apiClient.request('/auth/smtp-config', {
      method: 'PUT',
      body: JSON.stringify(config),
    });
  }
}

export const smtpConfigService = new SmtpConfigService();
```

- [ ] **Step 2: Write the useSmtpConfig hook**

```typescript
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useToast } from '@/lib/hooks/useToast';
import { smtpConfigService } from '@/features/auth/services/smtp-config.service';
import type { SmtpConfigSchema, UpsertSmtpConfigRequest } from '@insforge/shared-schemas';

export function useSmtpConfig() {
  const queryClient = useQueryClient();
  const { showToast } = useToast();

  const {
    data: config,
    isLoading,
    error,
    refetch,
  } = useQuery<SmtpConfigSchema>({
    queryKey: ['smtp-config'],
    queryFn: () => smtpConfigService.getConfig(),
  });

  const updateConfigMutation = useMutation({
    mutationFn: (config: UpsertSmtpConfigRequest) => smtpConfigService.updateConfig(config),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['smtp-config'] });
      showToast('SMTP configuration updated successfully', 'success');
    },
    onError: (error: Error) => {
      showToast(error.message || 'Failed to update SMTP configuration', 'error');
    },
  });

  return {
    config,
    isLoading,
    isUpdating: updateConfigMutation.isPending,
    error,
    updateConfig: updateConfigMutation.mutate,
    refetch,
  };
}
```

- [ ] **Step 3: Commit**

```bash
cd /Users/gary/projects/insforge-repo/InsForge
git add frontend/src/features/auth/services/smtp-config.service.ts frontend/src/features/auth/hooks/useSmtpConfig.ts
git commit -m "feat(frontend): add SMTP config service and React Query hook"
```

---

## Task 11: Frontend — Email Template API service and hook

**Files:**
- Create: `frontend/src/features/auth/services/email-template.service.ts`
- Create: `frontend/src/features/auth/hooks/useEmailTemplates.ts`

- [ ] **Step 1: Write the email template API service**

```typescript
import { apiClient } from '@/lib/api/client';
import type {
  EmailTemplateSchema,
  ListEmailTemplatesResponse,
  UpdateEmailTemplateRequest,
} from '@insforge/shared-schemas';

export class EmailTemplateService {
  async getTemplates(): Promise<ListEmailTemplatesResponse> {
    return apiClient.request('/auth/email-templates');
  }

  async updateTemplate(
    type: string,
    data: UpdateEmailTemplateRequest
  ): Promise<EmailTemplateSchema> {
    return apiClient.request(`/auth/email-templates/${type}`, {
      method: 'PUT',
      body: JSON.stringify(data),
    });
  }
}

export const emailTemplateService = new EmailTemplateService();
```

- [ ] **Step 2: Write the useEmailTemplates hook**

```typescript
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useToast } from '@/lib/hooks/useToast';
import { emailTemplateService } from '@/features/auth/services/email-template.service';
import type {
  ListEmailTemplatesResponse,
  UpdateEmailTemplateRequest,
} from '@insforge/shared-schemas';

export function useEmailTemplates() {
  const queryClient = useQueryClient();
  const { showToast } = useToast();

  const {
    data: templates,
    isLoading,
    error,
    refetch,
  } = useQuery<ListEmailTemplatesResponse>({
    queryKey: ['email-templates'],
    queryFn: () => emailTemplateService.getTemplates(),
  });

  const updateTemplateMutation = useMutation({
    mutationFn: ({ type, data }: { type: string; data: UpdateEmailTemplateRequest }) =>
      emailTemplateService.updateTemplate(type, data),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['email-templates'] });
      showToast('Email template updated successfully', 'success');
    },
    onError: (error: Error) => {
      showToast(error.message || 'Failed to update email template', 'error');
    },
  });

  return {
    templates: templates?.data ?? [],
    isLoading,
    isUpdating: updateTemplateMutation.isPending,
    error,
    updateTemplate: updateTemplateMutation.mutate,
    refetch,
  };
}
```

- [ ] **Step 3: Commit**

```bash
cd /Users/gary/projects/insforge-repo/InsForge
git add frontend/src/features/auth/services/email-template.service.ts frontend/src/features/auth/hooks/useEmailTemplates.ts
git commit -m "feat(frontend): add email template service and React Query hook"
```

---

## Task 12: Frontend — SMTP Settings Card component

**Files:**
- Create: `frontend/src/features/auth/components/SmtpSettingsCard.tsx`

- [ ] **Step 1: Write the SmtpSettingsCard component**

```tsx
import { useEffect } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { Button, Input, Switch } from '@insforge/ui';
import {
  upsertSmtpConfigRequestSchema,
  type SmtpConfigSchema,
  type UpsertSmtpConfigRequest,
} from '@insforge/shared-schemas';

interface SmtpSettingsCardProps {
  config: SmtpConfigSchema | undefined;
  isLoading: boolean;
  isUpdating: boolean;
  onSave: (data: UpsertSmtpConfigRequest) => void;
}

interface SettingRowProps {
  label: string;
  description?: string;
  children: React.ReactNode;
}

function SettingRow({ label, description, children }: SettingRowProps) {
  return (
    <div className="flex w-full items-start gap-6">
      <div className="w-[300px] shrink-0">
        <div className="py-1.5">
          <p className="text-sm leading-5 text-foreground">{label}</p>
        </div>
        {description && (
          <p className="pt-1 pb-2 text-[13px] leading-[18px] text-muted-foreground">
            {description}
          </p>
        )}
      </div>
      <div className="min-w-0 flex-1">{children}</div>
    </div>
  );
}

export function SmtpSettingsCard({ config, isLoading, isUpdating, onSave }: SmtpSettingsCardProps) {
  const form = useForm<UpsertSmtpConfigRequest>({
    resolver: zodResolver(upsertSmtpConfigRequestSchema),
    defaultValues: {
      enabled: false,
      host: '',
      port: 465,
      username: '',
      password: undefined,
      senderEmail: '',
      senderName: '',
      minIntervalSeconds: 60,
    },
  });

  const enabled = form.watch('enabled');

  useEffect(() => {
    if (config) {
      form.reset({
        enabled: config.enabled,
        host: config.host,
        port: config.port,
        username: config.username,
        password: undefined, // Never pre-fill password
        senderEmail: config.senderEmail,
        senderName: config.senderName,
        minIntervalSeconds: config.minIntervalSeconds,
      });
    }
  }, [config, form]);

  const handleSubmit = () => {
    void form.handleSubmit((data) => {
      onSave(data);
    })();
  };

  if (isLoading) {
    return (
      <div className="flex h-[120px] items-center justify-center text-sm text-muted-foreground">
        Loading SMTP configuration...
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div>
        <h3 className="text-base font-medium text-foreground">SMTP Provider Settings</h3>
        <p className="mt-1 text-[13px] text-muted-foreground">
          Configure a custom SMTP server for sending emails. Your SMTP credentials will always be
          encrypted in our database.
        </p>
      </div>

      <SettingRow
        label="Enable Custom SMTP"
        description="Use your own SMTP server instead of InsForge cloud"
      >
        <Switch
          checked={enabled}
          onCheckedChange={(value) => form.setValue('enabled', value, { shouldDirty: true })}
        />
      </SettingRow>

      <div className={enabled ? '' : 'pointer-events-none opacity-50'}>
        <div className="space-y-6">
          <div>
            <h4 className="mb-4 text-sm font-medium text-foreground">Sender Details</h4>
            <div className="space-y-4">
              <SettingRow
                label="Sender email address"
                description="The email address the emails are sent from"
              >
                <Input
                  type="email"
                  placeholder="noreply@yourdomain.com"
                  {...form.register('senderEmail')}
                />
              </SettingRow>

              <SettingRow
                label="Sender name"
                description="Name displayed in the recipient's inbox"
              >
                <Input placeholder="Your App Name" {...form.register('senderName')} />
              </SettingRow>
            </div>
          </div>

          <div>
            <h4 className="mb-4 text-sm font-medium text-foreground">SMTP Provider Settings</h4>
            <div className="space-y-4">
              <SettingRow
                label="Host"
                description="Hostname or IP address of your SMTP server"
              >
                <Input placeholder="smtp.example.com" {...form.register('host')} />
              </SettingRow>

              <SettingRow
                label="Port number"
                description="Common ports: 465 (TLS) and 587 (STARTTLS). Avoid port 25."
              >
                <Input
                  type="number"
                  min="1"
                  max="65535"
                  {...form.register('port', { valueAsNumber: true })}
                />
              </SettingRow>

              <SettingRow
                label="Minimum interval per user"
                description="Minimum seconds between emails to the same user"
              >
                <Input
                  type="number"
                  min="0"
                  {...form.register('minIntervalSeconds', { valueAsNumber: true })}
                />
              </SettingRow>

              <SettingRow
                label="Username"
                description="Username for your SMTP server"
              >
                <Input placeholder="smtp-username" {...form.register('username')} />
              </SettingRow>

              <SettingRow
                label="Password"
                description="Password for your SMTP server. Cannot be viewed once saved."
              >
                <Input
                  type="password"
                  placeholder={config?.hasPassword ? '••••••••••••' : 'Enter SMTP password'}
                  {...form.register('password')}
                />
              </SettingRow>
            </div>
          </div>
        </div>
      </div>

      {form.formState.isDirty && (
        <div className="flex justify-end gap-2">
          <Button
            type="button"
            variant="secondary"
            onClick={() => form.reset()}
            disabled={isUpdating}
          >
            Cancel
          </Button>
          <Button type="button" onClick={handleSubmit} disabled={isUpdating}>
            {isUpdating ? 'Saving...' : 'Save'}
          </Button>
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 2: Verify it compiles**

```bash
cd /Users/gary/projects/insforge-repo/InsForge/frontend
npx tsc --noEmit
```

- [ ] **Step 3: Commit**

```bash
cd /Users/gary/projects/insforge-repo/InsForge
git add frontend/src/features/auth/components/SmtpSettingsCard.tsx
git commit -m "feat(frontend): add SMTP settings card component"
```

---

## Task 13: Frontend — Email Template Card component

**Files:**
- Create: `frontend/src/features/auth/components/EmailTemplateCard.tsx`

- [ ] **Step 1: Write the EmailTemplateCard component**

```tsx
import { useEffect, useState } from 'react';
import { Button, Input, Select, SelectContent, SelectItem, SelectTrigger } from '@insforge/ui';
import type { EmailTemplateSchema, UpdateEmailTemplateRequest } from '@insforge/shared-schemas';

interface EmailTemplateCardProps {
  templates: EmailTemplateSchema[];
  isLoading: boolean;
  isUpdating: boolean;
  onSave: (params: { type: string; data: UpdateEmailTemplateRequest }) => void;
}

const TEMPLATE_LABELS: Record<string, string> = {
  'email-verification-code': 'Email Verification (Code)',
  'email-verification-link': 'Email Verification (Link)',
  'reset-password-code': 'Password Reset (Code)',
  'reset-password-link': 'Password Reset (Link)',
};

const TEMPLATE_PLACEHOLDERS: Record<string, string[]> = {
  'email-verification-code': ['{{ code }}', '{{ email }}', '{{ app_name }}'],
  'email-verification-link': ['{{ link }}', '{{ email }}', '{{ app_name }}'],
  'reset-password-code': ['{{ code }}', '{{ email }}', '{{ app_name }}'],
  'reset-password-link': ['{{ link }}', '{{ email }}', '{{ app_name }}'],
};

type EditorTab = 'source' | 'preview';

export function EmailTemplateCard({
  templates,
  isLoading,
  isUpdating,
  onSave,
}: EmailTemplateCardProps) {
  const [selectedType, setSelectedType] = useState('email-verification-code');
  const [activeTab, setActiveTab] = useState<EditorTab>('source');
  const [subject, setSubject] = useState('');
  const [bodyHtml, setBodyHtml] = useState('');
  const [isDirty, setIsDirty] = useState(false);

  const selectedTemplate = templates.find((t) => t.templateType === selectedType);

  useEffect(() => {
    if (selectedTemplate) {
      setSubject(selectedTemplate.subject);
      setBodyHtml(selectedTemplate.bodyHtml);
      setIsDirty(false);
    }
  }, [selectedTemplate]);

  const handleSubjectChange = (value: string) => {
    setSubject(value);
    setIsDirty(true);
  };

  const handleBodyChange = (value: string) => {
    setBodyHtml(value);
    setIsDirty(true);
  };

  const handleSave = () => {
    onSave({
      type: selectedType,
      data: { subject, bodyHtml },
    });
    setIsDirty(false);
  };

  const handleCancel = () => {
    if (selectedTemplate) {
      setSubject(selectedTemplate.subject);
      setBodyHtml(selectedTemplate.bodyHtml);
      setIsDirty(false);
    }
  };

  if (isLoading) {
    return (
      <div className="flex h-[120px] items-center justify-center text-sm text-muted-foreground">
        Loading email templates...
      </div>
    );
  }

  const placeholders = TEMPLATE_PLACEHOLDERS[selectedType] ?? [];

  return (
    <div className="space-y-6">
      <div>
        <h3 className="text-base font-medium text-foreground">Email Templates</h3>
        <p className="mt-1 text-[13px] text-muted-foreground">
          Customize the email content sent to users. Templates use placeholders that are replaced
          with actual values when sent.
        </p>
      </div>

      <div className="space-y-4">
        <div className="flex w-full items-start gap-6">
          <div className="w-[300px] shrink-0">
            <p className="py-1.5 text-sm leading-5 text-foreground">Template</p>
          </div>
          <div className="min-w-0 flex-1">
            <Select value={selectedType} onValueChange={setSelectedType}>
              <SelectTrigger>
                <span>{TEMPLATE_LABELS[selectedType]}</span>
              </SelectTrigger>
              <SelectContent>
                {Object.entries(TEMPLATE_LABELS).map(([value, label]) => (
                  <SelectItem key={value} value={value}>
                    {label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>

        <div className="flex w-full items-start gap-6">
          <div className="w-[300px] shrink-0">
            <p className="py-1.5 text-sm leading-5 text-foreground">Subject</p>
          </div>
          <div className="min-w-0 flex-1">
            <Input
              value={subject}
              onChange={(e) => handleSubjectChange(e.target.value)}
              placeholder="Email subject line"
            />
          </div>
        </div>

        <div>
          <div className="mb-2 flex gap-1 border-b border-border">
            <button
              type="button"
              className={`px-3 py-1.5 text-sm font-medium ${
                activeTab === 'source'
                  ? 'border-b-2 border-foreground text-foreground'
                  : 'text-muted-foreground hover:text-foreground'
              }`}
              onClick={() => setActiveTab('source')}
            >
              Source
            </button>
            <button
              type="button"
              className={`px-3 py-1.5 text-sm font-medium ${
                activeTab === 'preview'
                  ? 'border-b-2 border-foreground text-foreground'
                  : 'text-muted-foreground hover:text-foreground'
              }`}
              onClick={() => setActiveTab('preview')}
            >
              Preview
            </button>
          </div>

          {activeTab === 'source' ? (
            <textarea
              value={bodyHtml}
              onChange={(e) => handleBodyChange(e.target.value)}
              className="h-[300px] w-full resize-y rounded-md border border-input bg-background px-3 py-2 font-mono text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-ring"
              placeholder="Enter HTML template..."
            />
          ) : (
            <div className="h-[300px] overflow-auto rounded-md border border-input bg-white">
              <iframe
                srcDoc={bodyHtml}
                title="Email template preview"
                className="h-full w-full border-0"
                sandbox=""
              />
            </div>
          )}

          {placeholders.length > 0 && (
            <p className="mt-2 text-xs text-muted-foreground">
              Available placeholders: {placeholders.join(', ')}
            </p>
          )}
        </div>
      </div>

      {isDirty && (
        <div className="flex justify-end gap-2">
          <Button type="button" variant="secondary" onClick={handleCancel} disabled={isUpdating}>
            Cancel
          </Button>
          <Button type="button" onClick={handleSave} disabled={isUpdating}>
            {isUpdating ? 'Saving...' : 'Save Template'}
          </Button>
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 2: Verify it compiles**

```bash
cd /Users/gary/projects/insforge-repo/InsForge/frontend
npx tsc --noEmit
```

- [ ] **Step 3: Commit**

```bash
cd /Users/gary/projects/insforge-repo/InsForge
git add frontend/src/features/auth/components/EmailTemplateCard.tsx
git commit -m "feat(frontend): add email template editor with source/preview tabs"
```

---

## Task 14: Frontend — Add "Email" tab to Auth Settings dialog

**Files:**
- Modify: `frontend/src/features/auth/components/AuthSettingsMenuDialog.tsx`

- [ ] **Step 1: Add imports**

Add at the top alongside existing imports:

```typescript
import { Send } from 'lucide-react';
import { useSmtpConfig } from '@/features/auth/hooks/useSmtpConfig';
import { useEmailTemplates } from '@/features/auth/hooks/useEmailTemplates';
import { SmtpSettingsCard } from './SmtpSettingsCard';
import { EmailTemplateCard } from './EmailTemplateCard';
```

- [ ] **Step 2: Update `AuthSettingsSection` type (line 42)**

Change:
```typescript
type AuthSettingsSection = 'general' | 'email-verification' | 'password';
```
To:
```typescript
type AuthSettingsSection = 'general' | 'email-verification' | 'password' | 'email';
```

- [ ] **Step 3: Add hooks inside the component (after the existing `useAuthConfig` call at line 101)**

```typescript
const {
  config: smtpConfig,
  isLoading: isSmtpLoading,
  isUpdating: isSmtpUpdating,
  updateConfig: updateSmtpConfig,
} = useSmtpConfig();
const {
  templates,
  isLoading: isTemplatesLoading,
  isUpdating: isTemplatesUpdating,
  updateTemplate,
} = useEmailTemplates();
```

- [ ] **Step 4: Update `sectionTitle` (around line 135)**

Add the `'email'` case:

```typescript
const sectionTitle = useMemo(() => {
  if (activeSection === 'email-verification') {
    return 'Email Verification';
  }
  if (activeSection === 'password') {
    return 'Password';
  }
  if (activeSection === 'email') {
    return 'Email';
  }
  return 'General';
}, [activeSection]);
```

- [ ] **Step 5: Add "Email" nav item**

Add after the Password `MenuDialogNavItem` (after line 178), before the closing `</MenuDialogNavList>`:

```tsx
<MenuDialogNavItem
  icon={<Send className="h-5 w-5" />}
  active={activeSection === 'email'}
  onClick={() => setActiveSection('email')}
>
  Email
</MenuDialogNavItem>
```

- [ ] **Step 6: Add "Email" section content**

Add after the `{activeSection === 'password' && (...)}` block (after line 401), inside the `<MenuDialogBody>`:

```tsx
{activeSection === 'email' && (
  <div className="space-y-10">
    <SmtpSettingsCard
      config={smtpConfig}
      isLoading={isSmtpLoading}
      isUpdating={isSmtpUpdating}
      onSave={updateSmtpConfig}
    />
    <div className="border-t border-border" />
    <EmailTemplateCard
      templates={templates}
      isLoading={isTemplatesLoading}
      isUpdating={isTemplatesUpdating}
      onSave={updateTemplate}
    />
  </div>
)}
```

- [ ] **Step 7: Ensure the Email tab's save/cancel buttons don't conflict with the auth config footer**

The existing `<MenuDialogFooter>` (lines 405-421) shows save/cancel only when `form.formState.isDirty`. Since the Email tab uses its own form state inside the card components, the footer save button should be hidden when on the Email tab. Update the footer condition:

Change:
```tsx
{form.formState.isDirty && (
```
To:
```tsx
{form.formState.isDirty && activeSection !== 'email' && (
```

- [ ] **Step 8: Verify it compiles**

```bash
cd /Users/gary/projects/insforge-repo/InsForge/frontend
npx tsc --noEmit
```

- [ ] **Step 9: Commit**

```bash
cd /Users/gary/projects/insforge-repo/InsForge
git add frontend/src/features/auth/components/AuthSettingsMenuDialog.tsx
git commit -m "feat(frontend): add Email tab to Auth Settings with SMTP and template editors"
```

---

## Task 15: Integration verification

- [ ] **Step 1: Run full backend type check**

```bash
cd /Users/gary/projects/insforge-repo/InsForge/backend
npx tsc --noEmit
```

Expected: No errors

- [ ] **Step 2: Run full frontend type check**

```bash
cd /Users/gary/projects/insforge-repo/InsForge/frontend
npx tsc --noEmit
```

Expected: No errors

- [ ] **Step 3: Run shared-schemas build**

```bash
cd /Users/gary/projects/insforge-repo/InsForge/shared-schemas
npx tsc --noEmit
```

Expected: No errors

- [ ] **Step 4: Run linter if available**

```bash
cd /Users/gary/projects/insforge-repo/InsForge
npm run lint --if-present
```

- [ ] **Step 5: Verify migration file is sequential**

```bash
ls /Users/gary/projects/insforge-repo/InsForge/backend/src/infra/database/migrations/ | sort
```

Expected: `024_create-smtp-config-and-email-templates.sql` follows `023_ai-configs-soft-delete.sql`

- [ ] **Step 6: Final commit (if any lint fixes needed)**

```bash
cd /Users/gary/projects/insforge-repo/InsForge
git add -A
git commit -m "fix: address lint issues from SMTP feature implementation"
```
