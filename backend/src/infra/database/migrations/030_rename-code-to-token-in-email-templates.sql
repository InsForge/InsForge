-- Migration: Rename {{ code }} placeholder to {{ token }} in seeded email templates
--
-- The auth service passes the OTP as `token` (to match the cloud email provider's
-- template variable convention). Installs that already ran migration 029 have
-- seeded template bodies containing `{{ code }}`, which would render literally
-- after this change. Replace those placeholders in-place.
--
-- Idempotent: the WHERE clause guards against re-runs and against user-customized
-- templates that no longer contain the literal `{{ code }}` placeholder.

UPDATE email.templates
SET body_html = REPLACE(body_html, '{{ code }}', '{{ token }}'),
    updated_at = NOW()
WHERE template_type IN ('email-verification-code', 'reset-password-code')
  AND body_html LIKE '%{{ code }}%';
