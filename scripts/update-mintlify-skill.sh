#!/usr/bin/env bash
#
# update-mintlify-skill.sh — refresh the vendored doc-author SKILL.md from
# upstream https://github.com/mintlify/docs and update the attribution header.
#
# The file .claude/skills/doc-author/SKILL.md is a verbatim copy of Mintlify's
# upstream skill body. This script:
#   1. Verifies the upstream repo license is still MIT (fails loudly otherwise).
#   2. Fetches the latest commit SHA for mintlify/docs@main.
#   3. Re-downloads the upstream SKILL.md.
#   4. Reassembles the local file with a fresh attribution block.
#
# Usage: scripts/update-mintlify-skill.sh [--force]
#
#   --force  Skip the "already up-to-date" no-op and rewrite anyway.
#
# Requires: curl, gh (authenticated, for the license + SHA queries), jq.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
SKILL_FILE="$REPO_ROOT/.claude/skills/doc-author/SKILL.md"
UPSTREAM_RAW="https://raw.githubusercontent.com/mintlify/docs/main/.claude/skills/doc-author/SKILL.md"
EXPECTED_LICENSE="MIT"
FORCE=0

for arg in "$@"; do
  case "$arg" in
    --force) FORCE=1 ;;
    -h|--help)
      sed -n '2,20p' "$0" | sed 's/^# \{0,1\}//'
      exit 0
      ;;
    *) echo "unknown argument: $arg" >&2; exit 2 ;;
  esac
done

command -v curl >/dev/null || { echo "curl is required" >&2; exit 1; }
command -v gh   >/dev/null || { echo "gh is required (authenticate with 'gh auth login')" >&2; exit 1; }
command -v jq   >/dev/null || { echo "jq is required" >&2; exit 1; }

[[ -f "$SKILL_FILE" ]] || { echo "missing: $SKILL_FILE" >&2; exit 1; }

# 1. License check — fail loudly if upstream relicensed.
UPSTREAM_LICENSE="$(gh api /repos/mintlify/docs --jq '.license.spdx_id')"
if [[ "$UPSTREAM_LICENSE" != "$EXPECTED_LICENSE" ]]; then
  cat >&2 <<EOF
WARNING: upstream license changed.
  expected: $EXPECTED_LICENSE
  got:      $UPSTREAM_LICENSE

Do NOT run this update blindly. Review mintlify/docs' new LICENSE file and
confirm vendoring is still permitted. If it is, update EXPECTED_LICENSE in
this script and the 'Upstream license' line in the attribution block of
.claude/skills/doc-author/SKILL.md, then rerun with --force.
EOF
  exit 3
fi

# 2. Capture current upstream SHA (short form, 12 chars).
UPSTREAM_SHA="$(gh api /repos/mintlify/docs/commits/main --jq '.sha' | cut -c1-12)"
if [[ -z "$UPSTREAM_SHA" ]]; then
  echo "failed to fetch upstream SHA" >&2
  exit 1
fi

# 3. No-op short-circuit: if the local attribution header already names this SHA
#    and we're not forcing, bail.
if [[ "$FORCE" -ne 1 ]] && grep -q "commit $UPSTREAM_SHA" "$SKILL_FILE"; then
  echo "up-to-date: $SKILL_FILE already references $UPSTREAM_SHA"
  exit 0
fi

# 4. Fetch upstream body.
TMP="$(mktemp)"
trap 'rm -f "$TMP"' EXIT
if ! curl -fsSL "$UPSTREAM_RAW" -o "$TMP"; then
  echo "failed to fetch $UPSTREAM_RAW" >&2
  exit 1
fi
[[ -s "$TMP" ]] || { echo "downloaded file is empty" >&2; exit 1; }

# Quick sanity check: must start with YAML frontmatter.
head -n1 "$TMP" | grep -q '^---$' || {
  echo "upstream SKILL.md no longer starts with YAML frontmatter; aborting" >&2
  exit 1
}

# Find the closing '---' of upstream frontmatter (second '---' line).
FRONTMATTER_END="$(grep -n '^---$' "$TMP" | sed -n '2p' | cut -d: -f1)"
if [[ -z "$FRONTMATTER_END" ]]; then
  echo "could not locate closing frontmatter marker in upstream file" >&2
  exit 1
fi

TODAY="$(date -u +%Y-%m-%d)"

# 5. Reassemble: upstream frontmatter + our attribution block + upstream body.
{
  sed -n "1,${FRONTMATTER_END}p" "$TMP"
  cat <<EOF

<!--
  Vendored from https://github.com/mintlify/docs (commit $UPSTREAM_SHA)
  Upstream path: .claude/skills/doc-author/SKILL.md
  Upstream license: $UPSTREAM_LICENSE (see LICENSE block in upstream repo)
  Vendored: $TODAY by scripts/update-mintlify-skill.sh

  This file is a VERBATIM copy of Mintlify's doc-author skill body.
  Do not edit the prose below — local conventions go in ./INSFORGE.md
  Update with: scripts/update-mintlify-skill.sh
-->

EOF
  BODY_START=$((FRONTMATTER_END + 1))
  sed -n "${BODY_START},\$p" "$TMP"
} > "$SKILL_FILE"

echo "updated $SKILL_FILE -> commit $UPSTREAM_SHA ($UPSTREAM_LICENSE)"
