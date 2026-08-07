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
CLONED=

if [ -e "$TARGET/.git" ]; then
  cd "$TARGET"
elif [ -z "$1" ] && [ -e .git ] && [ -f deploy/docker-compose/docker-compose.yml ]; then
  : # no target given and we are already inside a checkout
else
  git clone --depth 1 --filter=blob:none --sparse "$REPO" "$TARGET"
  cd "$TARGET"
  CLONED=1
fi

ROOT=$(pwd)
ENV_FILE=.env

# A full checkout is somebody's development clone: the sparse-checkout below
# would empty its working tree, and COMPOSE_FILE would repoint its .env at the
# production compose file.
if [ -z "$CLONED" ] && [ "$(git config --get core.sparseCheckout)" != true ]; then
  echo "$ROOT is a full checkout, not a self-hosting one." >&2
  echo "Pass a target instead: sh deploy/setup.sh ~/insforge" >&2
  exit 1
fi

# Every file the image-only stack reads, plus this script so it travels with the
# checkout. Re-applied on every run, which is why the update procedure calls this
# after `git merge`: a release that adds a file the compose reads also ships the
# path for it here, and without re-applying, the merge would land the file in git
# but never in the working tree.
#
# --no-cone rather than cone mode: cone always adds every root-level file, which
# would include the development docker-compose.yml. With COMPOSE_FILE unset for
# any reason, `docker compose up` would then build from source and start dev
# servers instead of failing with "no configuration file provided".
#
# git's own docs call non-cone mode deprecated, so a future git dropping the
# flag would break this script rather than silently widening the checkout.
# There is no cone-mode spelling of "these root files but not those".
git sparse-checkout set --no-cone \
  /.env.example \
  /docker-compose.minio.yml /docker-compose.rustfs.yml \
  /functions/ \
  /deploy/setup.sh \
  /deploy/docker-compose/docker-compose.yml \
  /deploy/docker-init/db/

set_var() {
  tmp=$(mktemp)
  awk -v key="$1" -v val="$2" '
    $0 ~ "^"key"=" { print key "=" val; found=1; next }
    { print }
    END { if (!found) print key "=" val }
  ' "$ENV_FILE" > "$tmp" && mv "$tmp" "$ENV_FILE"
}

# Compose treats an empty value as unset, so `${JWT_SECRET:-dev-secret-...}`
# would fall back to the placeholder default. An openssl that fails — or is
# missing — must stop the script rather than hand out a known secret.
gen_secret() {
  value=$(openssl rand -hex "$2") || value=
  if [ -z "$value" ]; then
    # Leaving the half-written file behind would be worse than failing: the
    # re-run path below leaves an existing .env untouched, so the secrets would
    # never be generated and the stack would come up on the placeholders.
    rm -f "$ENV_FILE"
    echo "Could not generate $1: openssl rand failed. No .env was written." >&2
    exit 1
  fi
  set_var "$1" "$value"
}

COMPOSE_FILE_VALUE=deploy/docker-compose/docker-compose.yml

# Docker Compose reads .env, and COMPOSE_FILE within it, from the directory you
# run it in — so both live here and every command runs from here. Added only when
# absent, because a storage overlay appended by hand has to survive re-runs; the
# fresh-install path below sets it outright, replacing .env.example's development
# value.
pin_compose_file() {
  grep -q '^COMPOSE_FILE=' "$ENV_FILE" || set_var COMPOSE_FILE "$COMPOSE_FILE_VALUE"
}

# Installs from before this layout kept .env beside the compose file. Left there
# it is silently ignored, and secrets that no longer reach Postgres read as a
# lost database.
if [ -f deploy/docker-compose/.env ] && [ ! -f "$ENV_FILE" ]; then
  mv deploy/docker-compose/.env "$ENV_FILE"
  # The old location was not necessarily 600, and this branch exits before the
  # fresh-install path that sets it.
  chmod 600 "$ENV_FILE"
  pin_compose_file
  echo "Moved deploy/docker-compose/.env to $ROOT/.env."
  echo "Run docker compose from $ROOT from now on."
  exit 0
fi

if [ -f "$ENV_FILE" ]; then
  pin_compose_file
  echo "Checkout refreshed. $ROOT/.env already exists — left untouched."
  echo "Compare it against .env.example for variables added since you created it."
  exit 0
fi

cp .env.example "$ENV_FILE"
chmod 600 "$ENV_FILE"
set_var COMPOSE_FILE "$COMPOSE_FILE_VALUE"

# Generated as separate values on purpose. If ENCRYPTION_KEY is unset InsForge
# falls back to JWT_SECRET, and rotating JWT_SECRET afterwards makes every stored
# secret undecryptable.
gen_secret JWT_SECRET 32
gen_secret ENCRYPTION_KEY 32
gen_secret ROOT_ADMIN_PASSWORD 12

# Postgres reads this only when it initializes the cluster, so it has to be
# settled before the first boot — after that, editing .env changes nothing.
gen_secret POSTGRES_PASSWORD 16

cat <<DONE

Secrets generated in $ROOT/.env (mode 600).

Set the public URL browsers will use, then start:

  cd $ROOT
  \$EDITOR .env          # API_BASE_URL, VITE_API_BASE_URL
  docker compose up -d
DONE
