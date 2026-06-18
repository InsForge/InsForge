#!/usr/bin/env bash
#
# sync-skills.sh — mirror the canonical insforge-dev skill to the per-agent copies.
#
# .agents/skills/insforge-dev is the single source of truth. Claude Code and
# Codex each discover skills from their own directory, so we keep byte-identical
# copies in .claude/ and .codex/. Symlinks are not an option: Windows checkouts
# don't preserve them (they become plain text files), and Prettier errors on
# explicitly-passed symlinks. So we generate real copies and let CI guard drift.
#
# Edit ONLY .agents/skills/insforge-dev, then run this script and commit all
# three trees together.
#
# Usage:
#   scripts/sync-skills.sh          Copy canonical -> .claude and .codex
#   scripts/sync-skills.sh --check  Exit non-zero if any copy has drifted (CI)
#
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"

CANONICAL="$REPO_ROOT/.agents/skills/insforge-dev"
COPIES=(
  "$REPO_ROOT/.claude/skills/insforge-dev"
  "$REPO_ROOT/.codex/skills/insforge-dev"
)

CHECK=0
case "${1:-}" in
  --check) CHECK=1 ;;
  -h|--help) sed -n '2,18p' "$0" | sed 's/^# \{0,1\}//'; exit 0 ;;
  "") ;;
  *) echo "unknown argument: $1" >&2; exit 2 ;;
esac

[[ -d "$CANONICAL" ]] || { echo "missing canonical skill dir: $CANONICAL" >&2; exit 1; }

status=0
for copy in "${COPIES[@]}"; do
  if [[ "$CHECK" -eq 1 ]]; then
    if ! diff -r "$CANONICAL" "$copy" >/dev/null 2>&1; then
      echo "DRIFT: $copy is out of sync with the canonical $CANONICAL" >&2
      diff -ru "$CANONICAL" "$copy" >&2 || true
      status=1
    fi
  else
    rm -rf "$copy"
    mkdir -p "$(dirname "$copy")"
    cp -R "$CANONICAL" "$copy"
    echo "synced: $copy"
  fi
done

if [[ "$CHECK" -eq 1 ]]; then
  if [[ "$status" -eq 0 ]]; then
    echo "insforge-dev skill copies are in sync with .agents/"
  else
    echo "Run 'scripts/sync-skills.sh' and commit the result." >&2
  fi
fi
exit "$status"
