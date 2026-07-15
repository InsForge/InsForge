#!/usr/bin/env bash
# Validates docs i18n two ways:
#  1) every page path in every language's docs.json nav resolves to a file, and
#     each locale nav entry is actually prefixed with its locale (no silent
#     English fallback masking a missing translation);
#  2) every English nav page has a real translated file in all three locales.
set -euo pipefail
cd "$(dirname "$0")/.."
python3 - <<'PY'
import json, os, sys
DOCS='docs'; LOCALES=['zh','zh-TW','es']
d=json.load(open(os.path.join(DOCS,'docs.json'), encoding='utf-8'))
def walk(node,out):
    if isinstance(node,str): out.append(node)
    elif isinstance(node,list):
        for x in node: walk(x,out)
    elif isinstance(node,dict):
        for k,v in node.items():
            if k in ('pages','groups','tabs'): walk(v,out)
def resolve(p):
    return os.path.exists(os.path.join(DOCS,p+'.mdx')) or os.path.exists(os.path.join(DOCS,p+'.md'))
problems=[]
langs={l['language']:l for l in d['navigation']['languages']}
# 1) nav paths resolve + locale entries are prefixed
for lang,entry in langs.items():
    pages=[]; walk(entry['tabs'], pages)
    for p in pages:
        if p.startswith('http'): continue
        if not resolve(p): problems.append(f"{lang}: nav path does not resolve: {p}")
        if lang!='en' and not p.startswith(f"{lang}/"):
            problems.append(f"{lang}: nav entry not localized (English fallback): {p}")
# 2) every en nav page has all 3 locale translations
en_pages=[]; walk(langs['en']['tabs'], en_pages)
for p in en_pages:
    if p.startswith('http'): continue
    for loc in LOCALES:
        if not resolve(f"{loc}/{p}"): problems.append(f"{loc}: missing translation of {p}")
if problems:
    print("DOCS I18N PARITY FAILURES (%d):" % len(problems))
    for m in problems[:60]: print(' ',m)
    sys.exit(1)
print("docs i18n parity OK — nav resolves, all locale entries prefixed, every en page translated ×3")
PY
