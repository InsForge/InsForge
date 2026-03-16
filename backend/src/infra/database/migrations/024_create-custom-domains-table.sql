-- Migration: 024 - Create custom_domains table in system schema
--
-- Stores user-owned custom domains linked to the Vercel project.
-- Domain verification status:
--   PENDING  - Domain added but DNS not yet verified
--   VERIFIED - DNS records confirmed by Vercel
--   FAILED   - Verification attempted but DNS not configured correctly

CREATE TABLE IF NOT EXISTS system.custom_domains (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  domain TEXT NOT NULL UNIQUE,
  status TEXT NOT NULL DEFAULT 'PENDING',
  -- DNS records the user must configure
  cname_name TEXT,    -- e.g. "www" or "@"
  cname_value TEXT,   -- e.g. "cname.vercel-dns.com"
  a_record_value TEXT, -- e.g. "76.76.21.21"
  -- Vercel's own verification token (for proxied/conflicting domains)
  verification_type TEXT,
  verification_domain TEXT,
  verification_value TEXT,
  error TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_custom_domains_status ON system.custom_domains(status);
CREATE INDEX IF NOT EXISTS idx_custom_domains_domain ON system.custom_domains(domain);

DROP TRIGGER IF EXISTS update_system_custom_domains_updated_at ON system.custom_domains;
CREATE TRIGGER update_system_custom_domains_updated_at BEFORE UPDATE ON system.custom_domains
FOR EACH ROW EXECUTE FUNCTION system.update_updated_at();
