-- Create system.advisor_suppressions table.
-- Lets an admin mark an advisor finding as a known false positive / accepted
-- risk so it stops surfacing. Suppression state lives here (keyed by a stable
-- fingerprint), NOT on the per-scan system.advisor_findings rows, so it
-- survives re-scans. Two granularities:
--   scope = 'instance' : silence one (rule_id, affected_object) pair
--   scope = 'rule'     : silence a whole rule (affected_object IS NULL)
CREATE TABLE IF NOT EXISTS system.advisor_suppressions (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  rule_id         TEXT NOT NULL,
  affected_object TEXT,
  scope           TEXT NOT NULL DEFAULT 'instance' CHECK (scope IN ('instance', 'rule')),
  reason          TEXT NOT NULL CHECK (reason IN ('false_positive', 'accepted_risk', 'wont_fix')),
  note            TEXT,
  created_by      TEXT,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT advisor_suppressions_scope_object_ck CHECK (
    (scope = 'rule' AND affected_object IS NULL)
    OR (scope = 'instance' AND affected_object IS NOT NULL)
  )
);

-- One suppression per fingerprint. COALESCE folds the rule-level NULL into a
-- sentinel so a rule can only be muted once.
CREATE UNIQUE INDEX IF NOT EXISTS idx_advisor_suppressions_fingerprint
  ON system.advisor_suppressions (rule_id, COALESCE(affected_object, ''));
