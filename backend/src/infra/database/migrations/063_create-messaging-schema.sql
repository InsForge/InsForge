-- Migration 063: Create PostgreSQL-native messaging schema for outbox queue

CREATE SCHEMA IF NOT EXISTS messaging;

-- Outbox queue table
CREATE TABLE IF NOT EXISTS messaging.outbox (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    channel TEXT NOT NULL CHECK (channel IN ('email', 'sms', 'push')),
    status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'claimed', 'sent', 'failed', 'dead')),
    payload JSONB NOT NULL,
    idempotency_key TEXT,
    claimed_by TEXT,
    claimed_at TIMESTAMPTZ,
    lease_expires_at TIMESTAMPTZ,
    claim_token UUID DEFAULT NULL,
    retry_count INT NOT NULL DEFAULT 0,
    max_retries INT NOT NULL DEFAULT 5,
    next_attempt_at TIMESTAMPTZ DEFAULT NOW(),
    provider_message_id TEXT,
    error_message TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Unique index for idempotency keys within active outbox
CREATE UNIQUE INDEX IF NOT EXISTS idx_messaging_outbox_idempotency 
ON messaging.outbox (idempotency_key) 
WHERE idempotency_key IS NOT NULL;

-- Index for worker polling and atomic claims
CREATE INDEX IF NOT EXISTS idx_messaging_outbox_fetch 
ON messaging.outbox (next_attempt_at ASC, created_at ASC) 
WHERE status = 'pending';

-- Partial index for lease expiration recovery
CREATE INDEX IF NOT EXISTS idx_messaging_outbox_lease_expires 
ON messaging.outbox (lease_expires_at) 
WHERE status = 'claimed';

-- Delivery attempt log table
CREATE TABLE IF NOT EXISTS messaging.delivery_attempts (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    message_id UUID NOT NULL,
    attempt_number INT NOT NULL,
    worker_id TEXT NOT NULL,
    status TEXT NOT NULL,
    provider_message_id TEXT,
    error_message TEXT,
    attempted_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    duration_ms INT
);

CREATE INDEX IF NOT EXISTS idx_messaging_delivery_attempts_msg_id 
ON messaging.delivery_attempts (message_id);

-- Dead letter queue table
CREATE TABLE IF NOT EXISTS messaging.dead_letter (
    id UUID PRIMARY KEY,
    channel TEXT NOT NULL,
    payload JSONB NOT NULL,
    idempotency_key TEXT,
    retry_count INT NOT NULL,
    max_retries INT NOT NULL,
    error_message TEXT,
    created_at TIMESTAMPTZ NOT NULL,
    moved_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_messaging_dead_letter_idempotency 
ON messaging.dead_letter (idempotency_key) 
WHERE idempotency_key IS NOT NULL;

-- Trigger function for LISTEN / NOTIFY on new job insertion
CREATE OR REPLACE FUNCTION messaging.notify_new_job()
RETURNS TRIGGER AS $$
BEGIN
    PERFORM pg_notify('messaging_new_job', NEW.id::text);
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_messaging_notify_new_job ON messaging.outbox;
CREATE TRIGGER trg_messaging_notify_new_job
AFTER INSERT ON messaging.outbox
FOR EACH ROW
WHEN (NEW.status = 'pending')
EXECUTE FUNCTION messaging.notify_new_job();

-- Reconciliation function to recover expired leases and schedule retries
CREATE OR REPLACE FUNCTION messaging.reconcile_jobs(
    p_backoff_base_seconds INT DEFAULT 5,
    p_jitter_pct FLOAT DEFAULT 0.2
)
RETURNS INT AS $$
DECLARE
    v_count INT := 0;
    r RECORD;
    v_jitter_factor FLOAT;
    v_delay_seconds FLOAT;
BEGIN
    FOR r IN 
        SELECT id, retry_count, max_retries
        FROM messaging.outbox
        WHERE status = 'claimed' 
          AND lease_expires_at <= NOW()
        ORDER BY lease_expires_at ASC, id ASC
        LIMIT 100
        FOR UPDATE SKIP LOCKED
    LOOP
        v_count := v_count + 1;
        IF r.retry_count + 1 >= r.max_retries THEN
            -- Promote to dead_letter
            INSERT INTO messaging.dead_letter (
                id, channel, payload, idempotency_key, retry_count, max_retries, error_message, created_at, moved_at
            )
            SELECT id, channel, payload, idempotency_key, retry_count + 1, max_retries, 'Lease expired (max retries reached)', created_at, NOW()
            FROM messaging.outbox WHERE id = r.id;

            DELETE FROM messaging.outbox WHERE id = r.id;
        ELSE
            -- TODO: Use configurable backoff_base_seconds parameter instead of hardcoded 5s base
            v_jitter_factor := 1.0 + ((random() * 2.0 - 1.0) * p_jitter_pct);
            v_delay_seconds := (5.0 * power(2, r.retry_count)) * v_jitter_factor;

            UPDATE messaging.outbox
            SET status = 'pending',
                retry_count = retry_count + 1,
                claimed_by = NULL,
                claimed_at = NULL,
                lease_expires_at = NULL,
                claim_token = NULL,
                next_attempt_at = NOW() + (v_delay_seconds || ' seconds')::INTERVAL,
                updated_at = NOW()
            WHERE id = r.id;
        END IF;
    END LOOP;

    RETURN v_count;
END;
$$ LANGUAGE plpgsql;
