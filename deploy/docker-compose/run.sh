#!/usr/bin/env sh
# Run docker compose for the self-hosted stack, from any working directory.
#
#   ./run.sh up -d          ./run.sh logs -f insforge
#   ./run.sh pull           ./run.sh down
#   STORAGE=minio ./run.sh up -d      # bundled object store instead of local disk
#
# Arguments are forwarded to docker compose unchanged.
set -e
cd "$(dirname "$0")"

env_file=../../.env
if [ ! -f "$env_file" ]; then
  echo "No .env at the repository root." >&2
  echo "Create one with: cp .env.example .env" >&2
  exit 1
fi

# The project name decides the volume names, so it must stay stable across
# upgrades. It comes from COMPOSE_PROJECT_NAME in .env (compose reads it from
# --env-file); `insforge` matches deployments made before this script existed.
project=$(sed -n 's/^COMPOSE_PROJECT_NAME=//p' "$env_file" | tail -1)
project=${project:-insforge}

# Refuse to touch a project whose containers came from a different compose file.
# A fixed project name can collide with a development checkout of this repo, and
# `up` would silently replace those containers with this stack.
existing=$(docker ps -a \
  --filter "label=com.docker.compose.project=$project" \
  --format '{{.Label "com.docker.compose.project.config_files"}}' 2>/dev/null | head -1)
if [ -n "$existing" ] && ! echo "$existing" | grep -qF "$(pwd)/docker-compose.yml"; then
  echo "Compose project '$project' already has containers from:" >&2
  echo "  $existing" >&2
  echo >&2
  echo "Refusing to act on them. Set COMPOSE_PROJECT_NAME in your .env to a free name." >&2
  exit 1
fi

case "${STORAGE:-local}" in
  local)
    exec docker compose -f docker-compose.yml \
      -p "$project" --env-file "$env_file" "$@"
    ;;
  minio | rustfs)
    exec docker compose -f docker-compose.yml -f "../../docker-compose.$STORAGE.yml" \
      -p "$project" --env-file "$env_file" "$@"
    ;;
  *)
    echo "Unknown STORAGE=$STORAGE (expected local, minio or rustfs)" >&2
    exit 1
    ;;
esac
