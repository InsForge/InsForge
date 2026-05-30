-- Migration: 049 - Cached Storage Aggregates
--
-- Optimize O(N) storage queries by tracking object counts and total sizes 
-- incrementally via AFTER INSERT/UPDATE/DELETE triggers on storage.objects.

-- 1. Add cached aggregate columns to storage.buckets
ALTER TABLE storage.buckets 
ADD COLUMN object_count BIGINT DEFAULT 0 NOT NULL,
ADD COLUMN total_size_bytes BIGINT DEFAULT 0 NOT NULL;

-- 2. Define trigger function to sync aggregates
CREATE OR REPLACE FUNCTION storage.update_bucket_aggregates()
RETURNS TRIGGER AS $$
BEGIN
    IF (TG_OP = 'INSERT') THEN
        UPDATE storage.buckets
        SET 
            object_count = object_count + 1,
            total_size_bytes = total_size_bytes + COALESCE(NEW.size, 0),
            updated_at = CURRENT_TIMESTAMP
        WHERE name = NEW.bucket;
        
    ELSIF (TG_OP = 'DELETE') THEN
        UPDATE storage.buckets
        SET 
            object_count = GREATEST(0, object_count - 1),
            total_size_bytes = GREATEST(0, total_size_bytes - COALESCE(OLD.size, 0)),
            updated_at = CURRENT_TIMESTAMP
        WHERE name = OLD.bucket;
        
    ELSIF (TG_OP = 'UPDATE') THEN
        IF (OLD.bucket <> NEW.bucket) THEN
            -- Deduct from old bucket
            UPDATE storage.buckets
            SET 
                object_count = GREATEST(0, object_count - 1),
                total_size_bytes = GREATEST(0, total_size_bytes - COALESCE(OLD.size, 0)),
                updated_at = CURRENT_TIMESTAMP
            WHERE name = OLD.bucket;
            
            -- Add to new bucket
            UPDATE storage.buckets
            SET 
                object_count = object_count + 1,
                total_size_bytes = total_size_bytes + COALESCE(NEW.size, 0),
                updated_at = CURRENT_TIMESTAMP
            WHERE name = NEW.bucket;
        ELSIF (COALESCE(OLD.size, 0) <> COALESCE(NEW.size, 0)) THEN
            UPDATE storage.buckets
            SET 
                total_size_bytes = GREATEST(0, total_size_bytes + (COALESCE(NEW.size, 0) - COALESCE(OLD.size, 0))),
                updated_at = CURRENT_TIMESTAMP
            WHERE name = NEW.bucket;
        END IF;
    END IF;
    RETURN NULL;
END;
$$ LANGUAGE plpgsql;

-- 3. Bind the trigger to storage.objects
CREATE TRIGGER trg_storage_objects_aggregate_sync
AFTER INSERT OR UPDATE OR DELETE ON storage.objects
FOR EACH ROW
EXECUTE FUNCTION storage.update_bucket_aggregates();

-- 4. Transactionally backfill existing bucket counts and sizes
UPDATE storage.buckets b
SET 
  object_count = COALESCE((SELECT COUNT(*) FROM storage.objects o WHERE o.bucket = b.name), 0),
  total_size_bytes = COALESCE((SELECT SUM(size) FROM storage.objects o WHERE o.bucket = b.name), 0);
