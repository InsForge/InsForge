-- Normalize unset realtime channel runtime context.
--
-- PostgreSQL custom GUCs can read back as an empty string after a
-- transaction-local value is cleared on a reused session. RLS policies should
-- see one stable "no channel" value, so expose NULL rather than ''.
CREATE OR REPLACE FUNCTION realtime.channel_name()
RETURNS TEXT
LANGUAGE sql STABLE
AS $$
  SELECT nullif(current_setting('realtime.channel_name', true), '')
$$;

GRANT EXECUTE ON FUNCTION realtime.channel_name() TO authenticated, anon, project_admin;
