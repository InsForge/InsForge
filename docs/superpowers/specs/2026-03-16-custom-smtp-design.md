# Custom SMTP & Email Templates

## Overview

Allow project admins to configure their own SMTP server for email delivery instead of relying on InsForge's cloud backend. Includes customizable email templates with a Source/Preview editor.

## Motivation

Currently all emails (verification, password reset, raw) route through InsForge's cloud API. Self-hosted users and cloud users who prefer their own mail delivery have no alternative. This feature adds a pluggable SMTP provider and a template editor, following the same UX pattern as Supabase.

## Architecture

### Provider Selection Flow

```
EmailService.sendWithTemplate() / sendRaw()
  -> Check email.config (enabled?)
    -> YES: SmtpEmailProvider (nodemailer) + local template rendering
    -> NO:  CloudEmailProvider (current behavior, unchanged)
```

No breaking changes. The `EmailProvider` interface (`sendWithTemplate`, `sendRaw`, `supportsTemplates`) remains unchanged. Callers are unaffected.

## Database

### Table: `email.config` (singleton)

| Column | Type | Default | Description |
|--------|------|---------|-------------|
| id | UUID | gen_random_uuid() | Primary key |
| enabled | BOOLEAN | FALSE | Toggle SMTP on/off without deleting config |
| host | TEXT | NOT NULL | SMTP server hostname or IP |
| port | INTEGER | 465 | SMTP port (465 for TLS, 587 for STARTTLS) |
| username | TEXT | NOT NULL | SMTP auth username |
| password_encrypted | TEXT | NOT NULL | Encrypted SMTP password |
| sender_email | TEXT | NOT NULL | From address (e.g. noreply@yourdomain.com) |
| sender_name | TEXT | NOT NULL | Display name in recipient inbox |
| min_interval_seconds | INTEGER | 60 | Minimum seconds between emails to same user |
| created_at | TIMESTAMPTZ | NOW() | |
| updated_at | TIMESTAMPTZ | NOW() | |

Singleton enforced via unique index on constant expression (same pattern as `auth.configs`).

### Table: `email.templates`

| Column | Type | Default | Description |
|--------|------|---------|-------------|
| id | UUID | gen_random_uuid() | Primary key |
| template_type | TEXT | NOT NULL, UNIQUE | Template identifier |
| subject | TEXT | NOT NULL | Email subject line |
| body_html | TEXT | NOT NULL | Raw HTML with placeholder variables |
| created_at | TIMESTAMPTZ | NOW() | |
| updated_at | TIMESTAMPTZ | NOW() | |

### Template Types

- `email-verification-code`
- `email-verification-link`
- `reset-password-code`
- `reset-password-link`

### Template Placeholders

| Placeholder | Description | Available In |
|-------------|-------------|--------------|
| `{{ code }}` | 6-digit OTP code | verification-code, reset-password-code |
| `{{ link }}` | Verification/reset URL | verification-link, reset-password-link |
| `{{ email }}` | Recipient email address | All templates |

### Default Templates

Seeded on migration. Clean, minimal HTML with inline CSS. Example for `email-verification-code`:

- **Subject:** "Verify your email"
- **Body:** Simple centered card with "Your verification code is: {{ code }}" and expiry notice

## Backend

### New: `SmtpEmailProvider`

**Location:** `backend/src/providers/email/smtp.provider.ts`

- Implements `EmailProvider` interface
- Uses `nodemailer` to send emails
- `sendWithTemplate()`: queries `email.templates WHERE template_type = $1` using the `EmailTemplate` string value, replaces placeholders via string interpolation (all placeholder values are HTML-escaped before interpolation to prevent XSS), sends via SMTP
- `sendRaw()`: sends directly with provided to/subject/html/cc/bcc. The `from` field is always overridden with `sender_email`/`sender_name` from SMTP config (prevents spoofing)
- `supportsTemplates()`: returns `true`
- TLS auto-detected by nodemailer based on port (465 = implicit TLS, 587 = STARTTLS)
- Transporter created on-demand from DB config (config changes take effect without restart)

**Note:** Enabling SMTP automatically switches from cloud-rendered templates to locally-rendered templates from `email.templates`, even if the user has not customized them. The seeded defaults ensure this works out of the box.

### Modified: `EmailService`

**Location:** `backend/src/services/email/email.service.ts`

- On each send call, check `email.config` for an enabled config
- If enabled: delegate to `SmtpEmailProvider`
- If not enabled: delegate to `CloudEmailProvider` (current default)
- Provider is resolved per-call, not cached at startup

### New: SMTP Config Service

**Location:** `backend/src/services/email/smtp-config.service.ts`

- `getSmtpConfig()`: returns config with password masked
- `upsertSmtpConfig(input)`: creates or updates config, encrypts password using `EncryptionManager` (AES-256-GCM). On save, validates SMTP connection via `transporter.verify()` — rejects invalid credentials before persisting
- Singleton pattern (consistent with other services)

### New: Email Template Service

**Location:** `backend/src/services/email/email-template.service.ts`

- `getTemplates()`: returns all templates
- `getTemplate(type)`: returns single template
- `updateTemplate(type, subject, bodyHtml)`: updates a template

### Validation Schemas

New Zod schemas in `@insforge/shared-schemas` (consistent with existing patterns like `updateAuthConfigSchema`):

- `upsertSmtpConfigRequestSchema` — validates host, port (number), username, password (optional on update), sender_email (email format), sender_name, min_interval_seconds (positive integer), enabled (boolean)
- `updateEmailTemplateRequestSchema` — validates subject (non-empty string), body_html (non-empty string)

### API Endpoints

All endpoints require `verifyAdmin` middleware (same as `GET/PUT /api/auth/config`).
All PUT endpoints emit audit log entries via `auditService.log()` (consistent with existing `PUT /api/auth/config` pattern):
- `PUT /api/auth/smtp-config` → action: `'UPDATE_SMTP_CONFIG'`
- `PUT /api/auth/email-templates/:type` → action: `'UPDATE_EMAIL_TEMPLATE'`

#### SMTP Config

| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/auth/smtp-config` | Get SMTP config (password masked as boolean) |
| PUT | `/api/auth/smtp-config` | Create or update SMTP config |

#### Email Templates

| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/auth/email-templates` | Get all email templates |
| PUT | `/api/auth/email-templates/:type` | Update a template's subject and body |

### Password Handling

- Password encrypted before storage (never stored in plaintext)
- GET endpoint returns `has_password: true/false` instead of the actual value
- Password can only be overwritten, never viewed after saving

### Rate Limiting

- `min_interval_seconds` from SMTP config enforced at the service level
- Tracked via an in-memory `Map<string, number>` per recipient in `EmailService` (lightweight, no DB overhead; does not survive restarts or span multiple instances)
- Before sending, check if enough time has elapsed since the last email to the same recipient; reject with 429 if not
- All recipients are rate-limited (not just the primary), enforced for both `sendWithTemplate` and `sendRaw`
- This is a service-level check (not Express middleware), since it depends on per-recipient state rather than per-IP

## Frontend

### Auth Settings Dialog — New "Email" Tab

**Location:** `frontend/src/features/auth/components/AuthSettingsMenuDialog.tsx`

A new tab added alongside existing tabs (General, Email Verification, Password).

#### Card 1: SMTP Provider Settings

- **Toggle:** "Enable Custom SMTP" (switch)
- When enabled, show fields:
  - Sender email (text input)
  - Sender name (text input)
  - Host (text input)
  - Port (number input, default 465)
  - Minimum interval (number input, seconds, default 60)
  - Username (text input)
  - Password (password input, masked, cannot be viewed once saved)
- Save button
- Helper text: "Your SMTP credentials will always be encrypted in our database."

#### Card 2: Email Templates

- Dropdown: select template type
- Subject line (text input)
- Two sub-tabs: **Source** | **Preview**
  - Source: HTML textarea for editing raw HTML
  - Preview: rendered HTML in sandboxed iframe
- Helper text showing available placeholders for selected template type
- Save button (per template)

### UI Behavior

- Fields disabled when SMTP toggle is off
- Password field shows placeholder dots when a password exists, empty when not set
- Template preview updates live as user edits source HTML
- Follows existing dialog styling and component patterns
- The "Email" tab uses its own independent form state and API calls (separate from the existing auth config form), since it talks to different endpoints (`/api/auth/smtp-config` and `/api/auth/email-templates`)
- The `AuthSettingsSection` type union is extended with `'email'`

## Migration

**New migration file:** `backend/src/infra/database/migrations/0XX_create-smtp-config-and-email-templates.sql`

1. Create `email.config` table with singleton constraint
2. Create `email.templates` table
3. Seed 4 default templates with subjects and HTML bodies

## Dependencies

- `nodemailer` — new npm dependency for SMTP transport
- `@types/nodemailer` — dev dependency for TypeScript types
- No other new dependencies required

## Non-Goals

- Template engine (Handlebars, EJS, etc.) — simple string interpolation is sufficient
- Env-var-based SMTP config — can be added later as an enhancement
- Send Test Email button — not in Supabase's UX, not included here
- Additional template types beyond the existing 4 auth flows
- "Reset to Default" template button (known limitation — users must manually revert templates)

## Known Limitations

- No "Reset to Default" for templates — if a user edits a template and wants to revert, they must manually restore the original HTML
- Self-signed TLS certificates on SMTP servers are not supported (nodemailer rejects by default) — can be added later via an optional `tls_reject_unauthorized` flag
