-- Normalize unset realtime channel runtime context.
--
-- PostgreSQL custom GUCs can read back as an empty string after a
-- transaction-local value is cleared on a reused session. RLS policies should
-- see one stable "no channel" value, so expose NULL rather than ''.
--
-- CREATE OR REPLACE preserves the function's existing ACL, so the EXECUTE
-- grants made in 017 (authenticated, anon) and 045 (project_admin) carry over
-- without re-granting. We intentionally do not re-issue them: an unguarded
-- GRANT ... TO project_admin would abort the migration wherever that role is
-- absent -- the exact case 045-048 wrap in a pg_roles existence guard.
CREATE OR REPLACE FUNCTION realtime.channel_name()
RETURNS TEXT
LANGUAGE sql STABLE
AS $$
  SELECT nullif(current_setting('realtime.channel_name', true), '')
$$;
