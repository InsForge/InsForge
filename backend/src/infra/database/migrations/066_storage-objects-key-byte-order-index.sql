-- Migration 066: Index storage.objects keys in byte order for S3 ListObjectsV2.
--
-- S3 lists keys in UTF-8 byte order, so the S3 gateway sorts and pages with
-- key COLLATE "C". The primary key on (bucket, key) uses the database default
-- collation and cannot serve that ordering, which would force a sort of every
-- matching row in the bucket on each page. This index lets ListObjectsV2 walk
-- keys in byte order and turns its prefix filter into an index range.

CREATE INDEX IF NOT EXISTS idx_storage_objects_bucket_key_c
  ON storage.objects (bucket, key COLLATE "C");
