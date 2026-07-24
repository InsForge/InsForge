-- Migration 060: Create messaging schema for postgres-native outbox queue.
--
-- Mirroring delivery status, attempts audit, and dead letter records.
-- Native LISTEN/NOTIFY and pg_cron-based reconciliation.

CREATE SCHEMA IF NOT EXISTS messaging;

-- ============================================================================
-- OUTBOX TABLE
-- ============================================================================

CREATE TABLE IF NOT EXISTS messaging.outbox (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  channel TEXT NOT NULL CHECK (channel IN ('email', 'sms', 'push')),
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'claimed', 'sent', 'delivered', 'failed', 'dead')),
  payload JSONB NOT NULL,
  idempotency_key TEXT,
  claimed_by TEXT,
  claimed_at TIMESTAMPTZ,
  lease_expires_at TIMESTAMPTZ,
  retry_count INTEGER NOT NULL DEFAULT 0,
  max_retries INTEGER NOT NULL DEFAULT 5,
  next_attempt_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  provider_message_id TEXT,
  error_message TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Unique index for idempotency keys to prevent duplicate queued items
CREATE UNIQUE INDEX IF NOT EXISTS idx_messaging_outbox_idempotency
  ON messaging.outbox(idempotency_key)
  WHERE idempotency_key IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_messaging_outbox_status_next_attempt
  ON messaging.outbox(status, next_attempt_at)
  WHERE status = 'pending';

-- ============================================================================
-- DEAD LETTER TABLE
-- ============================================================================

CREATE TABLE IF NOT EXISTS messaging.dead_letter (
  id UUID PRIMARY KEY,
  channel TEXT NOT NULL CHECK (channel IN ('email', 'sms', 'push')),
  payload JSONB NOT NULL,
  idempotency_key TEXT,
  retry_count INTEGER NOT NULL,
  max_retries INTEGER NOT NULL,
  error_message TEXT,
  created_at TIMESTAMPTZ NOT NULL,
  moved_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_messaging_dead_letter_idempotency
  ON messaging.dead_letter(idempotency_key)
  WHERE idempotency_key IS NOT NULL;

-- ============================================================================
-- DELIVERY ATTEMPTS TABLE
-- ============================================================================

CREATE TABLE IF NOT EXISTS messaging.delivery_attempts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  message_id UUID NOT NULL,
  worker_id TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('sent', 'failed')),
  error_message TEXT,
  duration_ms INTEGER,
  attempted_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_messaging_delivery_attempts_message_id
  ON messaging.delivery_attempts(message_id);

-- ============================================================================
-- NOTIFY TRIGGER
-- ============================================================================

CREATE OR REPLACE FUNCTION messaging.notify_on_job_insert()
RETURNS TRIGGER AS $$
BEGIN
  -- Send message ID to bypass pg_notify payload limits. Worker claims via FOR UPDATE SKIP LOCKED.
  PERFORM pg_notify('messaging_new_job', NEW.id::text);
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_messaging_new_job ON messaging.outbox;
CREATE TRIGGER trg_messaging_new_job
  AFTER INSERT ON messaging.outbox
  FOR EACH ROW
  EXECUTE FUNCTION messaging.notify_on_job_insert();

-- ============================================================================
-- RECONCILIATION FUNCTION
-- ============================================================================

CREATE OR REPLACE FUNCTION messaging.reconcile_jobs()
RETURNS void AS $$
DECLARE
  v_rec RECORD;
BEGIN
  -- Identify claimed jobs whose lease has expired
  FOR v_rec IN 
    SELECT * FROM messaging.outbox 
    WHERE status = 'claimed' AND lease_expires_at < NOW()
  LOOP
    IF v_rec.retry_count >= v_rec.max_retries THEN
      -- Move to dead letter
      INSERT INTO messaging.dead_letter (
        id, channel, payload, idempotency_key, retry_count, max_retries, error_message, created_at, moved_at
      ) VALUES (
        v_rec.id, v_rec.channel, v_rec.payload, v_rec.idempotency_key, v_rec.retry_count, v_rec.max_retries, 
        'Lease expired and max retries reached. Orphan recovery.', v_rec.created_at, NOW()
      ) ON CONFLICT (id) DO UPDATE SET
        error_message = EXCLUDED.error_message,
        moved_at = NOW();
        
      -- Record failed delivery attempt for audit
      INSERT INTO messaging.delivery_attempts (
        message_id, worker_id, status, error_message, duration_ms, attempted_at
      ) VALUES (
        v_rec.id, COALESCE(v_rec.claimed_by, 'system-orphan-recovery'), 'failed', 'Lease expired (orphan recovery)', NULL, NOW()
      );
      
      DELETE FROM messaging.outbox WHERE id = v_rec.id;
    ELSE
      -- Reset status to pending for retry with simple exponential backoff
      UPDATE messaging.outbox 
      SET 
        status = 'pending',
        retry_count = retry_count + 1,
        claimed_by = NULL,
        claimed_at = NULL,
        lease_expires_at = NULL,
        error_message = 'Lease expired (orphan recovery)',
        next_attempt_at = NOW() + (INTERVAL '1 second' * 5 * power(2, retry_count)),
        updated_at = NOW()
      WHERE id = v_rec.id;
      
      -- Record failed delivery attempt for audit
      INSERT INTO messaging.delivery_attempts (
        message_id, worker_id, status, error_message, duration_ms, attempted_at
      ) VALUES (
        v_rec.id, COALESCE(v_rec.claimed_by, 'system-orphan-recovery'), 'failed', 'Lease expired (orphan recovery)', NULL, NOW()
      );
    END IF;
  END LOOP;
END;
$$ LANGUAGE plpgsql;

-- ============================================================================
-- GRANTS & SCHEDULE
-- ============================================================================

GRANT USAGE ON SCHEMA messaging TO anon, authenticated, project_admin;
GRANT SELECT ON messaging.outbox TO authenticated, project_admin;
GRANT SELECT ON messaging.dead_letter TO project_admin;
GRANT SELECT ON messaging.delivery_attempts TO project_admin;

-- Schedule pg_cron reconciliation if the cron extension is active
DO $$
DECLARE
  v_existing_job_id BIGINT;
BEGIN
  IF EXISTS (
    SELECT FROM information_schema.tables 
    WHERE table_schema = 'cron' AND table_name = 'job'
  ) THEN
    FOR v_existing_job_id IN
      SELECT jobid FROM cron.job WHERE jobname = 'messaging-reconciliation'
    LOOP
      PERFORM cron.unschedule(v_existing_job_id);
    END LOOP;

    PERFORM cron.schedule(
      'messaging-reconciliation',
      '* * * * *', -- Run every minute
      'SELECT messaging.reconcile_jobs()'
    );
  END IF;
END $$;
