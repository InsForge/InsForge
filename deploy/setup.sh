#!/usr/bin/env sh
# Fetch the files a self-hosted InsForge needs, and generate its secrets.
#
#   curl -fsSL https://raw.githubusercontent.com/InsForge/InsForge/main/deploy/setup.sh | sh -s ~/insforge
#   sh deploy/setup.sh .        # re-apply after `git merge`, see below
#
# Safe to re-run: your values are kept, only COMPOSE_FILE is added or
# corrected. Starts nothing — review .env first, since Postgres reads it only
# at first boot.
#
# Environment:
#   INSFORGE_REF=vX.Y.Z   A tag, branch or commit instead of main.
#   INSFORGE_NO_GIT=1     Fetch over HTTPS instead of cloning. No update path.
#   INSFORGE_REPO=...     Clone source. INSFORGE_RAW=... for the HTTPS host.
set -e

REPO=${INSFORGE_REPO:-https://github.com/InsForge/InsForge.git}
# Derived from REPO, so a fork does not silently fetch the official files.
RAW=${INSFORGE_RAW:-$(echo "$REPO" |
  sed -e 's|^git@github\.com:|https://raw.githubusercontent.com/|' \
      -e 's|^https://github\.com/|https://raw.githubusercontent.com/|' \
      -e 's|\.git$||')}
REF=${INSFORGE_REF:-}
TARGET=${1:-insforge}
CLONED=
# Initialized rather than assigned only inside the branch below: an inherited
# NO_GIT from the caller's environment would otherwise skip acquisition entirely
# and run the rest against whatever directory invoked this.
NO_GIT=

# Move an existing checkout onto INSFORGE_REF. Without this the ref was honoured
# only by the first clone, so re-running with a different one reported success
# and changed nothing. git refuses rather than discarding local edits, which is
# the same protection the update path relies on.
checkout_ref() {
  [ -n "$REF" ] || return 0
  # The HTTPS path already fetched each file at $REF, and there is no repository
  # here to fetch into.
  [ -z "${NO_GIT:-}" ] || return 0
  git fetch --depth 1 origin "$REF" ||
    { echo "Could not fetch $REF from origin." >&2; exit 1; }
  git checkout --detach FETCH_HEAD ||
    { echo "Could not check out $REF. Commit or stash local changes first." >&2; exit 1; }
}


# Every file the image-only stack reads. Both acquisition modes read this list,
# so they cannot disagree about what the stack needs.
#
# Not this script: the git path adds it to the sparse patterns separately, and on
# the HTTPS path a ref older than this file would 404 and fail the whole fetch.
#
# functions/examples/ is left out on purpose: the runtime only loads server.ts.
FILES='.env.example
docker-compose.minio.yml
docker-compose.rustfs.yml
functions/deno.json
functions/server.ts
functions/worker-template.js
deploy/backup.sh
deploy/docker-compose/docker-compose.yml
deploy/docker-init/db/db-init.sql
deploy/docker-init/db/jwt.sql
deploy/docker-init/db/postgresql.conf'

# No git, or asked not to use it: fetch each file straight from the ref. 34KB in
# total, against 47MB for the repository tarball, and precise where a tar glob
# would not be — `*/functions` also matches backend/src/.../functions.
if [ -n "${INSFORGE_NO_GIT:-}" ] || ! command -v git >/dev/null 2>&1; then
  # Same guard as the git path below, and it matters more here: curl overwrites
  # tracked files in place without asking, where git at least refuses. A previous
  # self-host install is sparse, so it is not caught.
  # -e, not -d: in a linked worktree .git is a file, and this guard read as
  # "no git here" for exactly the tree it most needs to protect.
  if [ -e "$TARGET/.git" ] &&
     [ "$(git -C "$TARGET" config --get core.sparseCheckout 2>/dev/null)" != true ]; then
    echo "$TARGET is a git working tree. Fetching into it would overwrite files" >&2
    echo "it tracks, including uncommitted changes." >&2
    echo "Pass a directory of its own: sh deploy/setup.sh ~/insforge" >&2
    exit 1
  fi
  mkdir -p "$TARGET"
  cd "$TARGET"
  for f in $FILES; do
    mkdir -p "$(dirname "$f")"
    curl -fsSL "$RAW/${REF:-main}/$f" -o "$f" ||
      { echo "Could not fetch $f at ${REF:-main} from $RAW." >&2; exit 1; }
  done
  chmod +x deploy/backup.sh
  NO_GIT=1
fi

if [ -n "${NO_GIT:-}" ]; then
  : # already fetched above
elif [ -e "$TARGET/.git" ]; then
  cd "$TARGET"
elif [ -z "$1" ] && [ -e .git ] && [ -f deploy/docker-compose/docker-compose.yml ]; then
  : # no target given and we are already inside a checkout
else
  # --branch takes a tag as well, so one flag covers both refs.
  git clone --depth 1 --filter=blob:none --sparse \
    ${REF:+--branch "$REF"} "$REPO" "$TARGET"
  cd "$TARGET"
  CLONED=1
fi

ROOT=$(pwd)
ENV_FILE=.env

# A full checkout is somebody's development clone: the sparse-checkout below
# would empty its working tree, and COMPOSE_FILE would repoint its .env at the
# production compose file.
if [ -z "${NO_GIT:-}" ] && [ -z "$CLONED" ] &&
   [ "$(git config --get core.sparseCheckout)" != true ]; then
  echo "$ROOT is a git working tree that is not a self-host checkout." >&2
  echo "Applying a sparse checkout here would empty it of everything outside" >&2
  echo "this script's file list. Pass a directory of its own instead:" >&2
  echo "  sh deploy/setup.sh ~/insforge" >&2
  exit 1
fi

# Only now that the guard has accepted this directory: moving HEAD first would
# leave a development checkout detached at the requested ref and *then* fail.
checkout_ref

# Every file the image-only stack reads, plus this script so it travels with the
# checkout. Re-applied on every run, which is why the update procedure calls this
# after `git merge`: a release that adds a file the compose reads also ships the
# path for it here, and without re-applying, the merge would land the file in git
# but never in the working tree.
#
# --no-cone: cone mode always adds every root-level file, including the
# development docker-compose.yml, and there is no cone-mode way to say "these
# root files but not those". git calls non-cone deprecated, so a git that drops
# the flag breaks this script rather than silently widening the checkout.
if [ -z "${NO_GIT:-}" ]; then
  # Leading slash anchors each pattern at the repository root.
  # shellcheck disable=SC2086
  git sparse-checkout set --no-cone /deploy/setup.sh \
    $(for f in $FILES; do printf '/%s ' "$f"; done)
fi

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
# $3 is an optional prefix the backend expects on that kind of key. It is added
# here rather than by the caller so a failed openssl cannot leave the prefix
# behind as the whole value — `ACCESS_API_KEY=ik_` is non-empty, so Compose would
# pass it through and the backend would seed three characters as its API key.
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
  set_var "$1" "${3:-}$value"
}

COMPOSE_FILE_VALUE=deploy/docker-compose/docker-compose.yml

# Docker Compose reads .env, and COMPOSE_FILE within it, from the directory you
# run it in — so both live here and every command runs from here. Added only when
# absent, because a storage overlay appended by hand has to survive re-runs; the
# fresh-install path below sets it outright, replacing .env.example's development
# value.
# Must equal .env.example's COMPOSE_FILE. Anyone who copied that template by
# hand is pointing at a file this checkout does not have.
DEV_COMPOSE_FILE_VALUE=docker-compose.yml

pin_compose_file() {
  if ! grep -q '^COMPOSE_FILE=' "$ENV_FILE"; then
    set_var COMPOSE_FILE "$COMPOSE_FILE_VALUE"
  elif grep -q "^COMPOSE_FILE=$DEV_COMPOSE_FILE_VALUE\$" "$ENV_FILE"; then
    # Copied from .env.example by hand. Neither of those files is in this
    # checkout, so the value cannot be what anyone here wants.
    set_var COMPOSE_FILE "$COMPOSE_FILE_VALUE"
    echo "Repointed COMPOSE_FILE from the development stack to $COMPOSE_FILE_VALUE."
  fi
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
  echo "Checkout refreshed. $ROOT/.env already exists — your values are kept."
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

# The keys the CLI and SDKs authenticate with. The backend would generate its own
# if these were empty, but then only it would know them; generating here means the
# install has credentials to hand out. Prefixed because the backend expects it.
gen_secret ACCESS_API_KEY 20 ik_
gen_secret ACCESS_ANON_KEY 20 anon_

cat <<DONE

Secrets generated in $ROOT/.env (mode 600).

Set the public URL browsers will use, then start:

  cd $ROOT
  \$EDITOR .env          # API_BASE_URL, VITE_API_BASE_URL
  docker compose up -d
DONE
