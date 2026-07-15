#!/usr/bin/env python3
"""Regenerate docs.json navigation.languages from the English (default) tree.

Idempotent: reads tabs from navigation.tabs if present (first run) or from the
en/default language entry (subsequent runs), then rebuilds all locale entries.
"""
import json, copy, os

DOCS = os.path.join(os.path.dirname(__file__), '..', 'docs')
CFG = os.path.join(DOCS, 'docs.json')
LOCALES = ['zh', 'zh-Hant', 'es']

d = json.load(open(CFG, encoding='utf-8'))
nav = d['navigation']
if 'tabs' in nav:
    base_tabs = nav['tabs']
    glob = nav.get('global')
else:
    langs = nav['languages']
    en = next(l for l in langs if l.get('default') or l['language'] == 'en')
    # strip the en/ prefix back off (en uses bare paths already, so just copy)
    base_tabs = copy.deepcopy(en['tabs'])
    glob = nav.get('global')

LABELS = json.load(open(os.path.join(os.path.dirname(__file__), 'docs-langs-labels.json'), encoding='utf-8'))

def resolves(path):
    p = os.path.join(DOCS, path)
    return os.path.exists(p + '.mdx') or os.path.exists(p + '.md')

def transform(node, loc):
    if isinstance(node, str):
        prefixed = f"{loc}/{node}"
        # Skip prefixing a page that has no translated file yet (avoid dead nav
        # links); fall back to the English page so the entry still resolves.
        return prefixed if resolves(prefixed) else node
    if isinstance(node, list):
        return [transform(x, loc) for x in node]
    if isinstance(node, dict):
        out = {}
        for k, v in node.items():
            if k in ('tab', 'group'):
                out[k] = LABELS[loc].get(v, v)
            elif k in ('pages', 'groups'):
                out[k] = [transform(x, loc) for x in v]
            else:
                out[k] = copy.deepcopy(v)
        return out
    return copy.deepcopy(node)

languages = [{'language': 'en', 'default': True, 'tabs': copy.deepcopy(base_tabs)}]
for loc in LOCALES:
    languages.append({'language': loc, 'tabs': [transform(t, loc) for t in base_tabs]})

nav_out = {'languages': languages}
if glob is not None:
    nav_out['global'] = glob
d['navigation'] = nav_out
with open(CFG, 'w', encoding='utf-8') as fh:
    json.dump(d, fh, ensure_ascii=False, indent=2)
    fh.write('\n')
print(f"docs.json rebuilt: {len(languages)} languages")
