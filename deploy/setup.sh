#!/usr/bin/env sh
# Check out the files a self-hosted InsForge needs, and generate its secrets.
#
#   curl -fsSL https://raw.githubusercontent.com/InsForge/InsForge/main/deploy/setup.sh | sh -s ~/insforge
#   sh deploy/setup.sh .        # re-apply after `git merge`, see below
#
# Safe to re-run: an existing .env is left untouched. Does not start anything —
# review .env first, since API_BASE_URL has to match the URL browsers will use
# and Postgres reads .env only at first boot.
set -e

REPO=${INSFORGE_REPO:-https://github.com/InsForge/InsForge.git}
TARGET=${1:-insforge}

if [ -d "$TARGET/.git" ]; then
  cd "$TARGET"
elif [ -d .git ] && [ -f deploy/docker-compose/docker-compose.yml ]; then
  : # already inside a checkout
else
  git clone --depth 1 --filter=blob:none --sparse "$REPO" "$TARGET"
  cd "$TARGET"
fi

# Every file the image-only stack reads, plus this script so it travels with the
# checkout. Re-applied on every run, which is why the update procedure calls this
# after `git merge`: a release that adds a file the compose reads also ships the
# path for it here, and without re-applying, the merge would land the file in git
# but never in the working tree.
#
# --no-cone rather than cone mode: cone always adds every root-level file, which
# would include the development docker-compose.yml. Running that in production
# builds from source and starts dev servers.
git sparse-checkout set --no-cone \
  /.env.example \
  /docker-compose.minio.yml /docker-compose.rustfs.yml \
  /deploy/setup.sh \
  /deploy/docker-compose/docker-compose.yml \
  /deploy/docker-init/db/

ENV_FILE=deploy/docker-compose/.env
if [ -f "$ENV_FILE" ]; then
  echo "Checkout refreshed. $ENV_FILE already exists — left untouched."
  echo "Compare it against .env.example for variables added since you created it."
  exit 0
fi

cp .env.example "$ENV_FILE"

# Generated as separate values on purpose. If ENCRYPTION_KEY is unset InsForge
# falls back to JWT_SECRET, and rotating JWT_SECRET afterwards makes every stored
# secret undecryptable.
set_var() {
  tmp=$(mktemp)
  awk -v key="$1" -v val="$2" '
    $0 ~ "^"key"=" { print key "=" val; found=1; next }
    { print }
    END { if (!found) print key "=" val }
  ' "$ENV_FILE" > "$tmp" && mv "$tmp" "$ENV_FILE"
}

set_var JWT_SECRET "$(openssl rand -hex 32)"
set_var ENCRYPTION_KEY "$(openssl rand -hex 32)"
set_var ROOT_ADMIN_PASSWORD "$(openssl rand -hex 12)"

chmod 600 "$ENV_FILE"

cat <<'DONE'

Secrets generated in deploy/docker-compose/.env (mode 600).

Before starting, set the public URL browsers will use:
  API_BASE_URL, VITE_API_BASE_URL

Then:
  cd deploy/docker-compose
  docker compose up -d
DONE
