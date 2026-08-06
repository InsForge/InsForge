#!/usr/bin/env sh
# Update the self-hosted stack: pull the repository, pull images, restart.
#
#   ./update.sh            show what would change, then stop
#   ./update.sh --apply    apply it
#
# Back up the database first — an image update can run migrations that an older
# image cannot read afterwards:
#   ./run.sh exec -T postgres pg_dump -U postgres insforge > backup.sql
set -e
cd "$(dirname "$0")"

git -C ../.. fetch origin main

if git -C ../.. diff --quiet HEAD origin/main; then
  echo "Already up to date."
  exit 0
fi

echo "Changes to be applied:"
git -C ../.. diff --stat HEAD origin/main -- deploy docker-compose.minio.yml docker-compose.rustfs.yml .env.example

if [ "${1:-}" != "--apply" ]; then
  echo
  echo "Review the diff above, then re-run with --apply."
  echo "New variables in .env.example must be copied into your .env by hand."
  exit 0
fi

git -C ../.. merge --ff-only origin/main
./run.sh pull
./run.sh up -d
echo
echo "Updated. Check the stack with: ./run.sh ps"
