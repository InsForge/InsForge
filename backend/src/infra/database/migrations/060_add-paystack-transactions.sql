-- Paystack transaction sessions, mirroring payments.razorpay_orders.
-- Shared projection tables (payments.provider_connections, payments.transactions,
-- payments.webhook_events, payments.customers) are provider-agnostic and accept
-- provider = 'paystack' without changes.

CREATE TABLE IF NOT EXISTS payments.paystack_transactions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  environment TEXT NOT NULL CHECK (environment IN ('test', 'live')),
  -- initialized and failed are InsForge-local lifecycle states; pending,
  -- success, and abandoned mirror Paystack transaction statuses.
  status TEXT NOT NULL DEFAULT 'initialized' CHECK (
    status IN ('initialized', 'pending', 'success', 'failed', 'abandoned')
  ),
  subject_type TEXT,
  subject_id TEXT,
  customer_email TEXT,
  -- Owning authenticated user; NULL for anon-initiated sessions. Verification
  -- is bound to this identity because Paystack references leak through
  -- callback URLs and receipts, unlike Razorpay's client-held HMAC proof.
  created_by UUID,
  -- Nullable until provider initialization succeeds. Unique only when non-null;
  -- the initialize flow updates rows by the local UUID id.
  reference TEXT,
  access_code TEXT,
  authorization_url TEXT,
  amount BIGINT NOT NULL,
  currency TEXT NOT NULL,
  verified_transaction_id TEXT,
  verified_at TIMESTAMPTZ,
  callback_url TEXT,
  metadata JSONB NOT NULL DEFAULT '{}'::JSONB,
  raw JSONB NOT NULL DEFAULT '{}'::JSONB,
  last_error TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

DROP TRIGGER IF EXISTS trg_payments_paystack_transactions_updated_at
  ON payments.paystack_transactions;
CREATE TRIGGER trg_payments_paystack_transactions_updated_at
BEFORE UPDATE ON payments.paystack_transactions
FOR EACH ROW EXECUTE FUNCTION system.update_updated_at();

GRANT INSERT, SELECT ON payments.paystack_transactions TO anon, authenticated, project_admin;
GRANT INSERT, UPDATE ON payments.paystack_transactions TO project_admin;

CREATE INDEX IF NOT EXISTS idx_payments_paystack_transactions_environment_status
  ON payments.paystack_transactions(environment, status);

CREATE INDEX IF NOT EXISTS idx_payments_paystack_transactions_environment_subject
  ON payments.paystack_transactions(environment, subject_type, subject_id)
  WHERE subject_type IS NOT NULL
    AND subject_id IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS idx_payments_paystack_transactions_environment_reference
  ON payments.paystack_transactions(environment, reference)
  WHERE reference IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_payments_paystack_transactions_environment_verified
  ON payments.paystack_transactions(environment, verified_transaction_id)
  WHERE verified_transaction_id IS NOT NULL;
