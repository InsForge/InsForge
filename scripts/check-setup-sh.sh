#!/usr/bin/env sh
# Structural checks on deploy/setup.sh.
#
# Every rule here exists because the invariant it guards was broken after being
# established — twice by bypassing a helper written to enforce it, once by
# inserting a call ahead of the guard meant to run first. Those regressions do
# not show up in a diff review or a happy-path run, so they are asserted here.
#
#   sh scripts/check-setup-sh.sh
set -e

SCRIPT=deploy/setup.sh
fails=0

fail() {
  echo "✗ $1" >&2
  fails=$((fails + 1))
}

# ── Secrets ─────────────────────────────────────────────────────────────────
# gen_secret aborts and removes the half-written .env when openssl fails.
# set_var does not, and Compose treats a non-empty value as authoritative — so a
# secret written with set_var can ship as the empty string, or as a bare prefix.
if grep -nE '^set_var (JWT_SECRET|ENCRYPTION_KEY|ROOT_ADMIN_PASSWORD|POSTGRES_PASSWORD|ACCESS_API_KEY|ACCESS_ANON_KEY)' "$SCRIPT"; then
  fail "secret written with set_var; use gen_secret so a failed openssl aborts"
fi

# Same rule stated the other way: nothing may inline a generator into set_var.
if grep -nE 'set_var [A-Z_]+ ".*\$\(openssl' "$SCRIPT"; then
  fail "openssl inlined into set_var; the prefix would survive as the value"
fi

# ── Guard ordering ──────────────────────────────────────────────────────────
# Anything that writes to the target has to run after the guard that refuses a
# git working tree, or the guard reports damage it was placed there to prevent.
guard=$(grep -n 'is a git working tree that is not' "$SCRIPT" | head -1 | cut -d: -f1)
[ -n "$guard" ] || fail "cannot find the working-tree guard"
if [ -n "$guard" ]; then
  for op in '^checkout_ref$' '^ *git sparse-checkout set' '^cp \.env\.example'; do
    line=$(grep -nE "$op" "$SCRIPT" | head -1 | cut -d: -f1)
    if [ -n "$line" ] && [ "$line" -lt "$guard" ]; then
      fail "$op runs at line $line, before the guard at $guard"
    fi
  done
fi

# ── git presence ────────────────────────────────────────────────────────────
# In a linked worktree .git is a file, so -d reads as "no repository here" for
# exactly the tree the guard most needs to catch.
if grep -nE '\[ -d "\$[A-Za-z_]+/\.git" \]' "$SCRIPT"; then
  fail "-d on a .git path; use -e so a linked worktree is not missed"
fi

# Every git call has to be skipped in the HTTPS path, where there is no
# repository to run it against.
if ! grep -q '\[ -z "${NO_GIT:-}" \] || return 0' "$SCRIPT"; then
  fail "checkout_ref does not bail out when NO_GIT is set"
fi

# ── File list ───────────────────────────────────────────────────────────────
# Both acquisition modes read FILES, so a path in one and not the other means a
# self-host install differs by how it was fetched.
if grep -q '^deploy/setup\.sh$' "$SCRIPT"; then
  fail "deploy/setup.sh is in FILES; refs older than it 404 the whole fetch"
fi

# Every path FILES names has to exist, or the fetch fails for everyone at once.
list=$(sed -n "/^FILES='/,/'$/p" "$SCRIPT" | sed -e "s/^FILES='//" -e "s/'$//")
for f in $list; do
  [ -e "$f" ] || fail "FILES names $f, which is not in this repository"
done

# And every file the compose file mounts has to be in FILES, or the stack starts
# without it.
# Strip every leading ../ so ../docker-init/db/x and ../../functions both reduce
# to the repository-relative path FILES uses.
for mounted in $(grep -oE '^ *- \.\.[./]*[a-z][a-z/.-]*' deploy/docker-compose/docker-compose.yml |
    sed -e 's|^ *- ||' -e 's|^\(\.\./\)*||' | sort -u); do
  case $mounted in
    functions)
      echo "$list" | grep -q '^functions/' ||
        fail "compose mounts functions/, absent from FILES" ;;
    *)
      echo "$list" | grep -qF "$mounted" ||
        fail "compose mounts $mounted, absent from FILES" ;;
  esac
done

if [ "$fails" -eq 0 ]; then
  echo "✓ deploy/setup.sh: all structural checks passed"
else
  echo "$fails check(s) failed" >&2
  exit 1
fi
