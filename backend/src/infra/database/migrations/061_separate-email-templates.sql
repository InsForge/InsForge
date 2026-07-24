-- Migration: Separate Email Templates by Provider
-- Adds provider_type to email.templates so Custom SMTP and Default Cloud templates can be customized independently.

-- 1. Add provider_type column (defaulting to 'custom_smtp' for backwards compatibility with the original schema)
ALTER TABLE email.templates ADD COLUMN provider_type TEXT NOT NULL DEFAULT 'custom_smtp';

-- 2. Update the unique constraint to include provider_type
ALTER TABLE email.templates DROP CONSTRAINT IF EXISTS email_templates_type_unique;
ALTER TABLE email.templates ADD CONSTRAINT email_templates_type_provider_unique UNIQUE (template_type, provider_type);

-- 3. Duplicate existing templates for the 'default' provider
INSERT INTO email.templates (template_type, subject, body_html, provider_type)
SELECT template_type, subject, body_html, 'default'
FROM email.templates
WHERE provider_type = 'custom_smtp'
ON CONFLICT (template_type, provider_type) DO NOTHING;
