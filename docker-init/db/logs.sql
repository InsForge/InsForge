\set pguser `echo "$POSTGRES_USER"`

CREATE DATABASE _insforge WITH OWNER :pguser;

\c _insforge
create schema if not exists _analytics;
alter schema _analytics owner to :pguser;

\c insforge
