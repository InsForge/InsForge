-- Harden SECURITY DEFINER encryption functions in schedules schema:
-- 1. Revoke public access (these are only called internally by other schedules.* functions)
-- 2. Lock down search_path to prevent search_path hijacking attacks

REVOKE EXECUTE ON FUNCTION schedules.encrypt_headers(p_headers jsonb) FROM public;
REVOKE EXECUTE ON FUNCTION schedules.decrypt_headers(p_encrypted_headers text) FROM public;

ALTER FUNCTION schedules.encrypt_headers(p_headers jsonb) SET search_path = '';
ALTER FUNCTION schedules.decrypt_headers(p_encrypted_headers text) SET search_path = '';

-- Wrap auth.uid() in subquery so it is evaluated once per query instead of once per row
DROP POLICY IF EXISTS "Users can update own profile" ON auth.users;
CREATE POLICY "Users can update own profile" ON auth.users
  FOR UPDATE
  USING (id = (SELECT auth.uid()))
  WITH CHECK (id = (SELECT auth.uid()));
