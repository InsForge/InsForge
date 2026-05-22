-- Migration: 045 - Replace per-table project_admin RLS policies with explicit role grants
--
-- `project_admin` remains the HTTP/API-key admin role name for compatibility,
-- but database-level admin access should not require injecting a policy into
-- every RLS-enabled table. BYPASSRLS gives the role service-key behavior while
-- regular grants still define which objects it can touch.

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'project_admin') THEN
    EXECUTE 'ALTER ROLE project_admin BYPASSRLS';

    EXECUTE 'GRANT ALL ON SCHEMA public TO project_admin';
    EXECUTE 'GRANT ALL PRIVILEGES ON ALL TABLES IN SCHEMA public TO project_admin';
    EXECUTE 'GRANT ALL PRIVILEGES ON ALL SEQUENCES IN SCHEMA public TO project_admin';
    EXECUTE 'GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA public TO project_admin';

    EXECUTE 'ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL PRIVILEGES ON TABLES TO project_admin';
    EXECUTE 'ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL PRIVILEGES ON SEQUENCES TO project_admin';
    EXECUTE 'ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT EXECUTE ON FUNCTIONS TO project_admin';

    -- Auth is an internal schema, so keep schema creation reserved for the owner
    -- and explicitly enumerate table privileges for project_admin/API-key access.
    EXECUTE 'GRANT USAGE ON SCHEMA auth TO project_admin';
    EXECUTE 'REVOKE ALL PRIVILEGES ON ALL TABLES IN SCHEMA auth FROM project_admin';
    EXECUTE 'GRANT SELECT ON ALL TABLES IN SCHEMA auth TO project_admin';
    EXECUTE 'GRANT INSERT, UPDATE, DELETE, REFERENCES, TRIGGER ON TABLE auth.users TO project_admin';
    EXECUTE 'GRANT INSERT, UPDATE, DELETE ON TABLE auth.oauth_configs TO project_admin';
    EXECUTE 'GRANT INSERT, UPDATE, DELETE ON TABLE auth.custom_oauth_configs TO project_admin';
    EXECUTE 'GRANT INSERT, UPDATE, DELETE ON TABLE auth.email_otps TO project_admin';
    EXECUTE 'GRANT INSERT, UPDATE, DELETE ON TABLE auth.user_providers TO project_admin';

    -- Compute service rows are system-managed; writes must go through the
    -- compute API so external Fly resources and audit logs stay consistent.
    EXECUTE 'GRANT USAGE ON SCHEMA compute TO project_admin';
    EXECUTE 'REVOKE ALL PRIVILEGES ON ALL TABLES IN SCHEMA compute FROM project_admin';
    EXECUTE 'GRANT SELECT ON ALL TABLES IN SCHEMA compute TO project_admin';

    -- Deployment records mirror provider/S3 state; writes must go through the
    -- deployment API so external resources and audit logs stay consistent.
    EXECUTE 'GRANT USAGE ON SCHEMA deployments TO project_admin';
    EXECUTE 'REVOKE ALL PRIVILEGES ON ALL TABLES IN SCHEMA deployments FROM project_admin';
    EXECUTE 'GRANT SELECT ON ALL TABLES IN SCHEMA deployments TO project_admin';

    -- Email templates are developer-owned configuration; SMTP provider config
    -- should be updated through the API so validation/encryption is preserved.
    EXECUTE 'GRANT USAGE ON SCHEMA email TO project_admin';
    EXECUTE 'REVOKE ALL PRIVILEGES ON ALL TABLES IN SCHEMA email FROM project_admin';
    EXECUTE 'GRANT SELECT ON ALL TABLES IN SCHEMA email TO project_admin';
    EXECUTE 'GRANT INSERT, UPDATE, DELETE ON TABLE email.templates TO project_admin';

    -- Function rows are deployment inputs; writes must go through the functions
    -- API so runtime deploys, audit logs, and socket updates stay consistent.
    EXECUTE 'GRANT USAGE ON SCHEMA functions TO project_admin';
    EXECUTE 'REVOKE ALL PRIVILEGES ON ALL TABLES IN SCHEMA functions FROM project_admin';
    EXECUTE 'GRANT SELECT ON ALL TABLES IN SCHEMA functions TO project_admin';

    -- Payments tables mirror Stripe and runtime payment state. Keep writes on
    -- Stripe-managed data behind the payments API/webhooks, while allowing
    -- runtime session inserts and developer-owned business triggers.
    EXECUTE 'GRANT USAGE ON SCHEMA payments TO project_admin';
    EXECUTE 'REVOKE ALL PRIVILEGES ON ALL TABLES IN SCHEMA payments FROM project_admin';
    EXECUTE 'GRANT SELECT ON ALL TABLES IN SCHEMA payments TO project_admin';
    EXECUTE 'GRANT INSERT, TRIGGER ON TABLE payments.checkout_sessions TO project_admin';
    EXECUTE 'GRANT INSERT, TRIGGER ON TABLE payments.customer_portal_sessions TO project_admin';
    EXECUTE 'GRANT TRIGGER ON TABLE payments.subscriptions TO project_admin';
    EXECUTE 'GRANT TRIGGER ON TABLE payments.payment_history TO project_admin';
    EXECUTE 'GRANT TRIGGER ON TABLE payments.customers TO project_admin';

    -- Realtime channel definitions and publish authorization are developer
    -- configuration. Message delivery internals remain system-managed.
    EXECUTE 'GRANT USAGE ON SCHEMA realtime TO project_admin';
    EXECUTE 'REVOKE ALL PRIVILEGES ON ALL TABLES IN SCHEMA realtime FROM project_admin';
    EXECUTE 'GRANT SELECT ON ALL TABLES IN SCHEMA realtime TO project_admin';
    EXECUTE 'GRANT INSERT, UPDATE, DELETE ON TABLE realtime.channels TO project_admin';
    EXECUTE 'GRANT INSERT ON TABLE realtime.messages TO project_admin';
    EXECUTE 'GRANT EXECUTE ON FUNCTION realtime.channel_name() TO project_admin';
    EXECUTE 'GRANT EXECUTE ON FUNCTION realtime.publish(TEXT, TEXT, JSONB) TO project_admin';

    -- Schedules coordinate rows, encrypted headers, and pg_cron state through
    -- the schedules API/functions; direct table writes can desynchronize them.
    EXECUTE 'GRANT USAGE ON SCHEMA schedules TO project_admin';
    EXECUTE 'REVOKE ALL PRIVILEGES ON ALL TABLES IN SCHEMA schedules FROM project_admin';
    EXECUTE 'GRANT SELECT ON ALL TABLES IN SCHEMA schedules TO project_admin';

    -- Storage buckets/config are managed through the storage API so provider
    -- state, validation, audit logs, and socket updates stay consistent.
    -- Object rows remain visible and referenceable for developer-owned
    -- metadata relations; object mutations must go through the storage API.
    EXECUTE 'GRANT USAGE ON SCHEMA storage TO project_admin';
    EXECUTE 'REVOKE ALL PRIVILEGES ON ALL TABLES IN SCHEMA storage FROM project_admin';
    EXECUTE 'GRANT SELECT ON TABLE storage.buckets, storage.objects, storage.config TO project_admin';
    EXECUTE 'GRANT SELECT ON TABLE storage.s3_access_keys TO project_admin';
    EXECUTE 'GRANT REFERENCES (bucket, key) ON TABLE storage.objects TO project_admin';

    -- System tables are read-only from project_admin/raw SQL. Mutations must go
    -- through services so secrets, audit, usage, and migration state stay valid.
    EXECUTE 'GRANT USAGE ON SCHEMA system TO project_admin';
    EXECUTE 'REVOKE ALL PRIVILEGES ON ALL TABLES IN SCHEMA system FROM project_admin';
    EXECUTE 'GRANT SELECT ON ALL TABLES IN SCHEMA system TO project_admin';
    EXECUTE 'GRANT EXECUTE ON FUNCTION system.update_updated_at() TO project_admin';
    EXECUTE 'GRANT EXECUTE ON FUNCTION system.reload_postgrest_schema() TO project_admin';
  END IF;
END $$;

DROP EVENT TRIGGER IF EXISTS create_policies_on_table_create;
DROP EVENT TRIGGER IF EXISTS create_policies_on_rls_enable;

DROP FUNCTION IF EXISTS system.create_default_policies() CASCADE;
DROP FUNCTION IF EXISTS system.create_policies_after_rls() CASCADE;

DO $$
DECLARE
  policy_record record;
BEGIN
  FOR policy_record IN
    SELECT schemaname, tablename, policyname
    FROM pg_policies
    WHERE policyname = 'project_admin_policy'
      -- Only remove policies generated by the old event trigger machinery.
      AND cmd = 'ALL'
      AND permissive = 'PERMISSIVE'
      AND roles = ARRAY['project_admin']::name[]
      AND qual IN ('true', '(true)')
      AND with_check IN ('true', '(true)')
  LOOP
    EXECUTE format(
      'DROP POLICY IF EXISTS %I ON %I.%I',
      policy_record.policyname,
      policy_record.schemaname,
      policy_record.tablename
    );
  END LOOP;
END $$;
