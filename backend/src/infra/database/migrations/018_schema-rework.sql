-- Migration: 018 - Create system and auth schemas, move and rename system tables
-- This migration creates dedicated schemas for internal system and auth tables,
-- moves tables into them, and removes the underscore prefix from table names.

-- ============================================================================
-- PART 1: SYSTEM SCHEMA (secrets, audit_logs, mcp_usage)
-- Note: migrations table is handled by bootstrap/bootstrap-migrations.js before this runs
-- ============================================================================

-- 1.1 Create the system schema (may already exist from bootstrap)
CREATE SCHEMA IF NOT EXISTS system;

-- 1.2 Move _secrets table to system schema and rename to 'secrets'
-- First, drop the foreign key constraint from _oauth_configs that references _secrets
ALTER TABLE public._oauth_configs
DROP CONSTRAINT IF EXISTS _oauth_configs_secret_id_fkey;

-- Move and rename the _secrets table to system.secrets
ALTER TABLE public._secrets SET SCHEMA system;
ALTER TABLE system._secrets RENAME TO secrets;

-- Note: We'll recreate the FK constraint after moving _oauth_configs to auth schema

-- 1.3 Move _audit_logs table to system schema and rename to 'audit_logs'
ALTER TABLE public._audit_logs SET SCHEMA system;
ALTER TABLE system._audit_logs RENAME TO audit_logs;

-- 1.4 Move _mcp_usage table to system schema and rename to 'mcp_usage'
ALTER TABLE public._mcp_usage SET SCHEMA system;
ALTER TABLE system._mcp_usage RENAME TO mcp_usage;

-- Note: system schema is internal and should NOT be exposed to PUBLIC.
-- Access is controlled through the application's database connection.

-- ============================================================================
-- PART 2: AUTH SCHEMA (users, user_providers, configs, oauth_configs, email_otps)
-- ============================================================================

-- 2.1 Create the auth schema
CREATE SCHEMA IF NOT EXISTS auth;

-- 2.2 Drop all foreign key constraints that reference tables being moved
-- FK: _account_providers.user_id -> _accounts(id)
ALTER TABLE public._account_providers
DROP CONSTRAINT IF EXISTS _account_providers_user_id_fkey;

-- FK: users.id -> _accounts(id) (public users table references _accounts)
ALTER TABLE public.users
DROP CONSTRAINT IF EXISTS users_id_fkey;

-- FK: _storage.uploaded_by -> _accounts(id)
ALTER TABLE public._storage
DROP CONSTRAINT IF EXISTS _storage_uploaded_by_fkey;

-- 2.3 Move _accounts table to auth schema and rename to 'users'
ALTER TABLE public._accounts SET SCHEMA auth;
ALTER TABLE auth._accounts RENAME TO users;

-- 2.4 Move _account_providers table to auth schema and rename to 'user_providers'
ALTER TABLE public._account_providers SET SCHEMA auth;
ALTER TABLE auth._account_providers RENAME TO user_providers;

-- 2.5 Recreate FK: auth.user_providers.user_id -> auth.users(id)
ALTER TABLE auth.user_providers
ADD CONSTRAINT user_providers_user_id_fkey
FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;

-- 2.6 Add profile and metadata JSONB columns to auth.users BEFORE migrating data
-- profile: stores user profile data (name, avatar_url, bio, etc.)
-- metadata: reserved for system use (device ID, login IP, etc.)
ALTER TABLE auth.users ADD COLUMN IF NOT EXISTS profile JSONB DEFAULT '{}'::jsonb;
ALTER TABLE auth.users ADD COLUMN IF NOT EXISTS metadata JSONB DEFAULT '{}'::jsonb;

-- 2.7 Migrate data from public.users into auth.users.profile
-- Priority for name: public.users.nickname first, then auth.users.name as fallback
-- Also migrate: avatar_url, bio, birthday from public.users
UPDATE auth.users AS au
SET profile = jsonb_strip_nulls(jsonb_build_object(
  'name', COALESCE(pu.nickname, au.name),
  'avatar_url', pu.avatar_url,
  'bio', pu.bio,
  'birthday', pu.birthday
))
FROM public.users AS pu
WHERE au.id = pu.id;

-- 2.8 For users without a public.users row, migrate auth.users.name to profile
UPDATE auth.users
SET profile = jsonb_build_object('name', name)
WHERE name IS NOT NULL
  AND (profile IS NULL OR profile = '{}'::jsonb)
  AND id NOT IN (SELECT id FROM public.users);

-- 2.9 Update all foreign key constraints that reference public.users to use auth.users instead
-- This handles any custom tables developers may have created that reference public.users
DO $$
DECLARE
  fk_record RECORD;
  drop_sql TEXT;
  create_sql TEXT;
BEGIN
  -- Find all foreign keys that reference public.users
  FOR fk_record IN
    SELECT
      tc.table_schema,
      tc.table_name,
      tc.constraint_name,
      kcu.column_name,
      rc.delete_rule,
      rc.update_rule
    FROM information_schema.table_constraints tc
    JOIN information_schema.key_column_usage kcu
      ON tc.constraint_name = kcu.constraint_name
      AND tc.table_schema = kcu.table_schema
    JOIN information_schema.referential_constraints rc
      ON tc.constraint_name = rc.constraint_name
      AND tc.table_schema = rc.constraint_schema
    JOIN information_schema.constraint_column_usage ccu
      ON rc.unique_constraint_name = ccu.constraint_name
      AND rc.unique_constraint_schema = ccu.constraint_schema
    WHERE tc.constraint_type = 'FOREIGN KEY'
      AND ccu.table_schema = 'public'
      AND ccu.table_name = 'users'
  LOOP
    -- Drop the old foreign key
    drop_sql := format(
      'ALTER TABLE %I.%I DROP CONSTRAINT IF EXISTS %I',
      fk_record.table_schema,
      fk_record.table_name,
      fk_record.constraint_name
    );
    EXECUTE drop_sql;

    -- Recreate with reference to auth.users
    create_sql := format(
      'ALTER TABLE %I.%I ADD CONSTRAINT %I FOREIGN KEY (%I) REFERENCES auth.users(id) ON DELETE %s ON UPDATE %s',
      fk_record.table_schema,
      fk_record.table_name,
      fk_record.constraint_name,
      fk_record.column_name,
      fk_record.delete_rule,
      fk_record.update_rule
    );
    EXECUTE create_sql;

    RAISE NOTICE 'Updated FK constraint % on %.% to reference auth.users',
      fk_record.constraint_name, fk_record.table_schema, fk_record.table_name;
  END LOOP;
END $$;

-- 2.10 Drop public.users table (profile data now stored in auth.users.profile)
-- First drop RLS policies
DROP POLICY IF EXISTS "Enable read access for all users" ON public.users;
DROP POLICY IF EXISTS "Disable delete for users" ON public.users;
DROP POLICY IF EXISTS "Enable update for users based on user_id" ON public.users;
-- Drop the table (CASCADE will handle any remaining dependencies)
DROP TABLE IF EXISTS public.users CASCADE;

-- 2.11 Drop the name column from auth.users (data already migrated to profile)
ALTER TABLE auth.users DROP COLUMN IF EXISTS name;

-- Note: _storage.uploaded_by FK is handled in Part 4 when moving to storage schema

-- 2.12 Add is_project_admin and is_anonymous columns to auth.users
ALTER TABLE auth.users ADD COLUMN IF NOT EXISTS is_project_admin BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE auth.users ADD COLUMN IF NOT EXISTS is_anonymous BOOLEAN NOT NULL DEFAULT false;

-- 2.13 Move _auth_configs table to auth schema and rename to 'configs'
ALTER TABLE public._auth_configs SET SCHEMA auth;
ALTER TABLE auth._auth_configs RENAME TO configs;

-- 2.14 Move _oauth_configs table to auth schema and rename to 'oauth_configs'
ALTER TABLE public._oauth_configs SET SCHEMA auth;
ALTER TABLE auth._oauth_configs RENAME TO oauth_configs;

-- 2.15 Recreate FK: auth.oauth_configs.secret_id -> system.secrets(id)
ALTER TABLE auth.oauth_configs
ADD CONSTRAINT oauth_configs_secret_id_fkey
FOREIGN KEY (secret_id) REFERENCES system.secrets(id) ON DELETE RESTRICT;

-- 2.16 Move _email_otps table to auth schema and rename to 'email_otps'
ALTER TABLE public._email_otps SET SCHEMA auth;
ALTER TABLE auth._email_otps RENAME TO email_otps;

-- Note: auth schema is internal and should NOT be exposed to PUBLIC.
-- However, we grant limited access to auth.users for public profile info.

-- 2.17 Grant limited public access to auth.users (only safe columns)
GRANT USAGE ON SCHEMA auth TO PUBLIC;

-- Grant SELECT on specific columns only (public profile info)
GRANT SELECT (id, profile, created_at) ON auth.users TO PUBLIC;

-- Grant UPDATE on profile column only (users can update their own profile)
GRANT UPDATE (profile) ON auth.users TO PUBLIC;

-- 2.18 Enable RLS on auth.users for row-level access control
-- Note: auth.uid() function already exists from migration 013
ALTER TABLE auth.users ENABLE ROW LEVEL SECURITY;

-- Policy: Everyone can SELECT public columns (id, profile, created_at)
-- Column-level GRANT above already restricts which columns can be read
CREATE POLICY "Public can view user profiles" ON auth.users
  FOR SELECT
  USING (true);

-- Policy: Users can only UPDATE their own row
CREATE POLICY "Users can update own profile" ON auth.users
  FOR UPDATE
  USING (id = auth.uid())
  WITH CHECK (id = auth.uid());

-- 2.19 Drop obsolete public schema helper functions (duplicates of auth.* from migration 013)
DROP FUNCTION IF EXISTS public.uid();
DROP FUNCTION IF EXISTS public.role();
DROP FUNCTION IF EXISTS public.email();

-- ============================================================================
-- PART 3: AI SCHEMA (configs, usage)
-- ============================================================================

-- 3.1 Create the ai schema
CREATE SCHEMA IF NOT EXISTS ai;

-- 3.2 Drop FK constraint from _ai_usage to _ai_configs before moving
ALTER TABLE public._ai_usage
DROP CONSTRAINT IF EXISTS _ai_usage_config_id_fkey;

-- 3.3 Move _ai_configs table to ai schema and rename to 'configs'
ALTER TABLE public._ai_configs SET SCHEMA ai;
ALTER TABLE ai._ai_configs RENAME TO configs;

-- 3.4 Move _ai_usage table to ai schema and rename to 'usage'
ALTER TABLE public._ai_usage SET SCHEMA ai;
ALTER TABLE ai._ai_usage RENAME TO usage;

-- 3.5 Recreate FK: ai.usage.config_id -> ai.configs(id)
ALTER TABLE ai.usage
ADD CONSTRAINT usage_config_id_fkey
FOREIGN KEY (config_id) REFERENCES ai.configs(id) ON DELETE NO ACTION;

-- Note: ai schema is internal and should NOT be exposed to PUBLIC.
-- Access is controlled through the application's database connection.

-- ============================================================================
-- PART 4: STORAGE SCHEMA (buckets, objects)
-- ============================================================================

-- 4.1 Create the storage schema
CREATE SCHEMA IF NOT EXISTS storage;

-- 4.2 Drop FK constraints from _storage before moving
ALTER TABLE public._storage
DROP CONSTRAINT IF EXISTS _storage_bucket_fkey;

ALTER TABLE public._storage
DROP CONSTRAINT IF EXISTS _storage_uploaded_by_fkey;

-- 4.3 Move _storage_buckets table to storage schema and rename to 'buckets'
ALTER TABLE public._storage_buckets SET SCHEMA storage;
ALTER TABLE storage._storage_buckets RENAME TO buckets;

-- 4.4 Move _storage table to storage schema and rename to 'objects'
ALTER TABLE public._storage SET SCHEMA storage;
ALTER TABLE storage._storage RENAME TO objects;

-- 4.5 Recreate FK: storage.objects.bucket -> storage.buckets(name)
ALTER TABLE storage.objects
ADD CONSTRAINT objects_bucket_fkey
FOREIGN KEY (bucket) REFERENCES storage.buckets(name) ON DELETE CASCADE;

-- 4.6 Recreate FK: storage.objects.uploaded_by -> auth.users(id)
ALTER TABLE storage.objects
ADD CONSTRAINT objects_uploaded_by_fkey
FOREIGN KEY (uploaded_by) REFERENCES auth.users(id) ON DELETE SET NULL;

-- Note: storage schema is internal and should NOT be exposed to PUBLIC.
-- Access is controlled through the application's database connection.

-- ============================================================================
-- PART 5: FUNCTIONS SCHEMA (definitions)
-- ============================================================================

-- 5.1 Create the functions schema
CREATE SCHEMA IF NOT EXISTS functions;

-- 5.2 Move _functions table to functions schema and rename to 'definitions'
ALTER TABLE public._functions SET SCHEMA functions;
ALTER TABLE functions._functions RENAME TO definitions;

-- Note: functions schema is internal and should NOT be exposed to PUBLIC.
-- Access is controlled through the application's database connection.

-- ============================================================================
-- PART 6: UTILITY FUNCTIONS CLEANUP
-- ============================================================================

-- 6.1 Create system.update_updated_at() function (replaces public.update_updated_at_column)
CREATE OR REPLACE FUNCTION system.update_updated_at()
RETURNS trigger AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- 6.2 Update all triggers to use system.update_updated_at() and rename (remove double underscore)

-- system.secrets: update__secrets_updated_at -> update_secrets_updated_at
DROP TRIGGER IF EXISTS update__secrets_updated_at ON system.secrets;
CREATE TRIGGER update_secrets_updated_at
  BEFORE UPDATE ON system.secrets
  FOR EACH ROW EXECUTE FUNCTION system.update_updated_at();

-- system.audit_logs: update__audit_logs_updated_at -> update_audit_logs_updated_at
DROP TRIGGER IF EXISTS update__audit_logs_updated_at ON system.audit_logs;
CREATE TRIGGER update_audit_logs_updated_at
  BEFORE UPDATE ON system.audit_logs
  FOR EACH ROW EXECUTE FUNCTION system.update_updated_at();

-- auth.configs: update__auth_configs_updated_at -> update_configs_updated_at
DROP TRIGGER IF EXISTS update__auth_configs_updated_at ON auth.configs;
CREATE TRIGGER update_configs_updated_at
  BEFORE UPDATE ON auth.configs
  FOR EACH ROW EXECUTE FUNCTION system.update_updated_at();

-- auth.oauth_configs: update__oauth_configs_updated_at -> update_oauth_configs_updated_at
DROP TRIGGER IF EXISTS update__oauth_configs_updated_at ON auth.oauth_configs;
CREATE TRIGGER update_oauth_configs_updated_at
  BEFORE UPDATE ON auth.oauth_configs
  FOR EACH ROW EXECUTE FUNCTION system.update_updated_at();

-- auth.email_otps: update__email_otps_updated_at -> update_email_otps_updated_at
DROP TRIGGER IF EXISTS update__email_otps_updated_at ON auth.email_otps;
CREATE TRIGGER update_email_otps_updated_at
  BEFORE UPDATE ON auth.email_otps
  FOR EACH ROW EXECUTE FUNCTION system.update_updated_at();

-- functions.definitions: update__edge_functions_updated_at -> update_definitions_updated_at
DROP TRIGGER IF EXISTS update__edge_functions_updated_at ON functions.definitions;
CREATE TRIGGER update_definitions_updated_at
  BEFORE UPDATE ON functions.definitions
  FOR EACH ROW EXECUTE FUNCTION system.update_updated_at();

-- realtime.channels: trg_channels_updated_at -> update_channels_updated_at
DROP TRIGGER IF EXISTS trg_channels_updated_at ON realtime.channels;
CREATE TRIGGER update_channels_updated_at
  BEFORE UPDATE ON realtime.channels
  FOR EACH ROW EXECUTE FUNCTION system.update_updated_at();

-- 6.3 Move reload_postgrest_schema to system schema
-- Recreate in system schema (ALTER FUNCTION SET SCHEMA doesn't work well with search_path)
CREATE OR REPLACE FUNCTION system.reload_postgrest_schema()
RETURNS void AS $$
BEGIN
    NOTIFY pgrst, 'reload schema';
    RAISE NOTICE 'PostgREST schema reload notification sent';
END
$$ LANGUAGE plpgsql;

-- 6.4 Move event trigger functions to system schema
-- These functions auto-create project_admin_policy when RLS is enabled on tables

-- First, drop the event triggers (they reference the old functions)
DROP EVENT TRIGGER IF EXISTS create_policies_on_table_create;
DROP EVENT TRIGGER IF EXISTS create_policies_on_rls_enable;

-- Recreate functions in system schema
CREATE OR REPLACE FUNCTION system.create_default_policies()
RETURNS event_trigger AS $$
DECLARE
  obj record;
  table_schema text;
  table_name text;
  has_rls boolean;
BEGIN
  FOR obj IN SELECT * FROM pg_event_trigger_ddl_commands() WHERE command_tag = 'CREATE TABLE'
  LOOP
    SELECT INTO table_schema, table_name
      split_part(obj.object_identity, '.', 1),
      trim(both '"' from split_part(obj.object_identity, '.', 2));
    SELECT INTO has_rls
      rowsecurity
    FROM pg_tables
    WHERE schemaname = table_schema
      AND tablename = table_name;
    IF has_rls THEN
      EXECUTE format('CREATE POLICY "project_admin_policy" ON %s FOR ALL TO project_admin USING (true) WITH CHECK (true)', obj.object_identity);
    END IF;
  END LOOP;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION system.create_policies_after_rls()
RETURNS event_trigger AS $$
DECLARE
  obj record;
  table_schema text;
  table_name text;
BEGIN
  FOR obj IN SELECT * FROM pg_event_trigger_ddl_commands() WHERE command_tag = 'ALTER TABLE'
  LOOP
    SELECT INTO table_schema, table_name
      split_part(obj.object_identity, '.', 1),
      trim(both '"' from split_part(obj.object_identity, '.', 2));
    IF EXISTS (
      SELECT 1 FROM pg_tables
      WHERE schemaname = table_schema
        AND tablename = table_name
        AND rowsecurity = true
    ) AND NOT EXISTS (
      SELECT 1 FROM pg_policies
      WHERE schemaname = table_schema
        AND tablename = table_name
    ) THEN
      EXECUTE format('CREATE POLICY "project_admin_policy" ON %s FOR ALL TO project_admin USING (true) WITH CHECK (true)', obj.object_identity);
    END IF;
  END LOOP;
END;
$$ LANGUAGE plpgsql;

-- Recreate event triggers pointing to system schema functions
CREATE EVENT TRIGGER create_policies_on_table_create
  ON ddl_command_end
  WHEN TAG IN ('CREATE TABLE')
  EXECUTE FUNCTION system.create_default_policies();

CREATE EVENT TRIGGER create_policies_on_rls_enable
  ON ddl_command_end
  WHEN TAG IN ('ALTER TABLE')
  EXECUTE FUNCTION system.create_policies_after_rls();

-- 6.5 Drop obsolete functions
DROP FUNCTION IF EXISTS public.create_default_policies();
DROP FUNCTION IF EXISTS public.create_policies_after_rls();
DROP FUNCTION IF EXISTS public.reload_postgrest_schema();
DROP FUNCTION IF EXISTS public.update_updated_at_column();
DROP FUNCTION IF EXISTS realtime.update_updated_at();
