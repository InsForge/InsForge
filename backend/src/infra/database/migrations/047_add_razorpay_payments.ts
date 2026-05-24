import { MigrationBuilder } from 'node-pg-migrate';

export function up(pgm: MigrationBuilder): void {
  pgm.sql(`
    CREATE TABLE payments.razorpay_connections (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      environment TEXT NOT NULL CHECK (environment IN ('test', 'live')),
      razorpay_account_id TEXT,
      razorpay_merchant_name TEXT,
      account_livemode BOOLEAN,
      status TEXT NOT NULL DEFAULT 'unconfigured' CHECK (status IN ('unconfigured', 'connected', 'error')),
      webhook_endpoint_id TEXT,
      webhook_endpoint_url TEXT,
      webhook_secret_id UUID REFERENCES system.secrets(id) ON DELETE SET NULL,
      api_key_id UUID REFERENCES system.secrets(id) ON DELETE SET NULL,
      api_secret_id UUID REFERENCES system.secrets(id) ON DELETE SET NULL,
      webhook_configured_at TIMESTAMPTZ,
      last_synced_at TIMESTAMPTZ,
      last_sync_status TEXT CHECK (last_sync_status IS NULL OR last_sync_status IN ('succeeded', 'failed')),
      last_sync_error TEXT,
      last_sync_counts JSONB NOT NULL DEFAULT '{}'::JSONB,
      raw JSONB NOT NULL DEFAULT '{}'::JSONB,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      UNIQUE (environment),
      CHECK (status != 'connected' OR (api_key_id IS NOT NULL AND api_secret_id IS NOT NULL))
    );

    DROP TRIGGER IF EXISTS trg_payments_razorpay_connections_updated_at ON payments.razorpay_connections;
    CREATE TRIGGER trg_payments_razorpay_connections_updated_at
    BEFORE UPDATE ON payments.razorpay_connections
    FOR EACH ROW EXECUTE FUNCTION system.update_updated_at();

    GRANT SELECT, INSERT, UPDATE, DELETE ON payments.razorpay_connections TO project_admin;
  `);
}

export function down(pgm: MigrationBuilder): void {
  pgm.sql(`
    REVOKE ALL ON payments.razorpay_connections FROM project_admin;
    DROP TABLE IF EXISTS payments.razorpay_connections;
  `);
}
