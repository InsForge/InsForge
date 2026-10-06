-- Migration: 065 - Restrict the http extension's outbound functions to project_admin
--
-- The http extension inherits Postgres' default EXECUTE grant to PUBLIC, so anon
-- and authenticated could call these through PostgREST RPC and make the database
-- send arbitrary outbound requests (SSRF).

REVOKE EXECUTE ON FUNCTION
  http(http_request),
  http_get(varchar),
  http_get(varchar, jsonb),
  http_post(varchar, varchar, varchar),
  http_post(varchar, jsonb),
  http_put(varchar, varchar, varchar),
  http_patch(varchar, varchar, varchar),
  http_delete(varchar),
  http_delete(varchar, varchar, varchar),
  http_head(varchar),
  http_set_curlopt(varchar, varchar),
  http_reset_curlopt(),
  http_list_curlopt()
FROM PUBLIC;

GRANT EXECUTE ON FUNCTION
  http(http_request),
  http_get(varchar),
  http_get(varchar, jsonb),
  http_post(varchar, varchar, varchar),
  http_post(varchar, jsonb),
  http_put(varchar, varchar, varchar),
  http_patch(varchar, varchar, varchar),
  http_delete(varchar),
  http_delete(varchar, varchar, varchar),
  http_head(varchar),
  http_set_curlopt(varchar, varchar),
  http_reset_curlopt(),
  http_list_curlopt()
TO project_admin;
