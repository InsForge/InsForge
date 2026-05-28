-- Up Migration

ALTER TABLE payments.razorpay_connections DROP CONSTRAINT IF EXISTS chk_connected_credentials;
ALTER TABLE payments.razorpay_connections DROP COLUMN IF EXISTS webhook_secret_id;
ALTER TABLE payments.razorpay_connections DROP COLUMN IF EXISTS api_key_id;
ALTER TABLE payments.razorpay_connections DROP COLUMN IF EXISTS api_secret_id;

-- Down Migration

-- We cannot cleanly recover the foreign keys without data loss or breaking constraints.
