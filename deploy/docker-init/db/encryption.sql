\set encryption_key `echo "${ENCRYPTION_KEY:-${JWT_SECRET:-}}"`

ALTER DATABASE postgres SET "app.encryption_key" TO :'encryption_key';
