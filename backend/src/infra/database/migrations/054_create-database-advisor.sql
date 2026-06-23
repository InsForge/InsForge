-- Create system.advisor_scans table
CREATE TABLE IF NOT EXISTS system.advisor_scans (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  status         TEXT NOT NULL CHECK (status IN ('running', 'completed', 'failed')),
  scan_type      TEXT NOT NULL DEFAULT 'manual' CHECK (scan_type IN ('manual', 'scheduled')),
  scanned_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  error_message  TEXT
);

-- Create system.advisor_findings table
CREATE TABLE IF NOT EXISTS system.advisor_findings (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  scan_id         UUID NOT NULL REFERENCES system.advisor_scans(id) ON DELETE CASCADE,
  rule_id         TEXT NOT NULL,
  severity        TEXT NOT NULL CHECK (severity IN ('critical', 'warning', 'info')),
  category        TEXT NOT NULL CHECK (category IN ('security', 'performance', 'health')),
  title           TEXT NOT NULL,
  description     TEXT NOT NULL,
  affected_object TEXT,
  recommendation  TEXT,
  is_resolved     BOOLEAN NOT NULL DEFAULT FALSE,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_advisor_scans_status ON system.advisor_scans(status);
CREATE INDEX IF NOT EXISTS idx_advisor_scans_scanned_at ON system.advisor_scans(scanned_at DESC);
CREATE INDEX IF NOT EXISTS idx_advisor_findings_scan_id ON system.advisor_findings(scan_id);
