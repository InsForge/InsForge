#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "${BASH_SOURCE[0]}")/.."

project_name="${COMPOSE_PROJECT_NAME:-$(basename "$PWD" | tr '[:upper:]' '[:lower:]' | sed -E 's/[^a-z0-9_-]//g')}"

echo 'Stopping services that depend on Postgres...'
docker compose stop insforge postgrest deno postgres >/dev/null 2>&1 || true
docker compose rm -f -s postgres >/dev/null 2>&1 || true

postgres_volume="$({
  docker volume ls -q \
    --filter "label=com.docker.compose.project=${project_name}" \
    --filter 'label=com.docker.compose.volume=postgres-data' \
    | head -n 1
} || true)"

if [[ -n "$postgres_volume" ]]; then
  echo "Removing Postgres volume: ${postgres_volume}"
  docker volume rm "$postgres_volume" >/dev/null
else
  echo 'No existing Postgres volume found.'
fi

echo 'Starting Postgres and PostgREST...'
docker compose up -d postgres postgrest

echo 'Running migrations and seed data...'
cd backend
npm run migrate:up
npm run seed:run

echo 'Database reset complete.'
