#!/usr/bin/env bash
# Validates docs i18n against docs.json: every page path in every language's
# navigation must resolve to a real .md/.mdx file. Catches both missing
# translations and dangling nav entries (.md pages included).
set -euo pipefail
cd "$(dirname "$0")/.."
python3 - <<'PY'
import json, os, sys
DOCS='docs'
d=json.load(open(os.path.join(DOCS,'docs.json')))
def walk(node,out):
    if isinstance(node,str): out.append(node)
    elif isinstance(node,list):
        for x in node: walk(x,out)
    elif isinstance(node,dict):
        for k,v in node.items():
            if k in ('pages','groups','tabs'): walk(v,out)
missing=[]
for lang in d['navigation']['languages']:
    pages=[]; walk(lang['tabs'], pages)
    for p in pages:
        if p.startswith('http'): continue
        if not (os.path.exists(os.path.join(DOCS,p+'.mdx')) or os.path.exists(os.path.join(DOCS,p+'.md'))):
            missing.append(f"{lang['language']}: {p}")
if missing:
    print("BROKEN NAV PAGES (%d):" % len(missing)); [print(' ',m) for m in missing]; sys.exit(1)
print("docs i18n nav parity OK — all language nav paths resolve")
PY
