#!/usr/bin/env bash
# Fails if any English docs/*.mdx lacks a zh / zh-TW / es counterpart.
set -euo pipefail
cd "$(dirname "$0")/../docs"
missing=0
while IFS= read -r f; do
  rel="${f#./}"
  case "$rel" in zh/*|zh-TW/*|es/*) continue;; esac
  for loc in zh zh-TW es; do
    [ -f "$loc/$rel" ] || { echo "MISSING: $loc/$rel"; missing=1; }
  done
done < <(find . -name '*.mdx' -not -path './node_modules/*')
[ "$missing" -eq 0 ] && echo "docs i18n parity OK" || exit 1
