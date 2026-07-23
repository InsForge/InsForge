\set encryption_key `echo "$ENCRYPTION_KEY"`
\set db_name `echo "${POSTGRES_DB:-insforge}"`

ALTER DATABASE :"db_name" SET "app.encryption_key" TO :'encryption_key';
