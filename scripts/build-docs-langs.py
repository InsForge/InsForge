#!/usr/bin/env python3
"""Regenerate docs.json navigation.languages from the English (default) tree.

Idempotent: reads tabs from navigation.tabs if present (first run) or from the
en/default language entry (subsequent runs), then rebuilds all locale entries.
"""
import json, copy, os, sys

DOCS = os.path.join(os.path.dirname(__file__), '..', 'docs')
CFG = os.path.join(DOCS, 'docs.json')
LOCALES = ['zh', 'zh-Hant', 'es']

LABELS = json.load(open(os.path.join(os.path.dirname(__file__), 'docs-langs-labels.json'), encoding='utf-8'))

def resolves(path):
    p = os.path.join(DOCS, path)
    return os.path.exists(p + '.mdx') or os.path.exists(p + '.md')

def transform(node, loc):
    """Rebuild one node for `loc`, or return None if it should not appear.

    A page with no translated file is omitted rather than emitted as the bare
    English path. Falling back looked kinder — the entry still resolved — but it
    put an English page in a localized sidebar with nothing to say it was not
    translated, and check-docs-i18n-parity.sh rejects exactly that ("no silent
    English fallback masking a missing translation"). Generator and checker
    disagreed, so a hand-fixed docs.json was undone by the next regeneration.
    """
    if isinstance(node, str):
        prefixed = f"{loc}/{node}"
        return prefixed if resolves(prefixed) else None
    if isinstance(node, list):
        return [t for t in (transform(x, loc) for x in node) if t is not None]
    if isinstance(node, dict):
        out = {}
        for k, v in node.items():
            if k in ('tab', 'group'):
                out[k] = LABELS[loc].get(v, v)
            elif k in ('pages', 'groups'):
                out[k] = [t for t in (transform(x, loc) for x in v) if t is not None]
            else:
                out[k] = copy.deepcopy(v)
        # Drop a group this pass emptied, so no heading is left with nothing
        # under it. A group that is already empty in the English tree is copied
        # through untouched: that is the English tree's business, not ours.
        had_children = bool(node.get('pages') or node.get('groups'))
        if had_children and not (out.get('pages') or out.get('groups')):
            return None
        return out
    return copy.deepcopy(node)

def build(base_tabs, glob):
    """Build the navigation.languages array from the English tab tree."""
    languages = [{'language': 'en', 'default': True, 'tabs': copy.deepcopy(base_tabs)}]
    for loc in LOCALES:
        tabs = [t for t in (transform(t, loc) for t in base_tabs) if t is not None]
        languages.append({'language': loc, 'tabs': tabs})
    nav_out = {'languages': languages}
    if glob is not None:
        nav_out['global'] = glob
    return nav_out


def main():
    d = json.load(open(CFG, encoding='utf-8'))
    nav = d['navigation']
    if 'tabs' in nav:
        base_tabs = nav['tabs']
        glob = nav.get('global')
    else:
        en = next(l for l in nav['languages'] if l.get('default') or l['language'] == 'en')
        # strip the en/ prefix back off (en uses bare paths already, so just copy)
        base_tabs = copy.deepcopy(en['tabs'])
        glob = nav.get('global')

    d['navigation'] = build(base_tabs, glob)
    with open(CFG, 'w', encoding='utf-8') as fh:
        json.dump(d, fh, ensure_ascii=False, indent=2)
        fh.write('\n')
    print(f"docs.json rebuilt: {len(d['navigation']['languages'])} languages")


def selftest():
    """Assert the omission and pruning behaviour. Run: build-docs-langs.py --selftest

    No framework and no fixture files: `resolves` is the only thing that touches
    the filesystem, so stubbing it is enough to drive every branch.
    """
    global resolves
    real_resolves = resolves
    # Only these translated pages exist.
    present = {'zh/kept', 'zh/nested/kept'}
    resolves = lambda path: path in present
    try:
        tabs = [
            {'tab': 'T', 'groups': [
                {'group': 'HasOne', 'pages': ['kept', 'untranslated']},
                {'group': 'AllMissing', 'pages': ['gone-a', 'gone-b']},
                {'group': 'EmptyInEnglish', 'pages': []},
                {'group': 'Outer', 'groups': [
                    {'group': 'InnerKept', 'pages': ['nested/kept']},
                    {'group': 'InnerGone', 'pages': ['nested/missing']},
                ]},
                {'group': 'MetaOnly', 'icon': 'star'},
            ]},
        ]
        zh = build(tabs, None)['languages'][1]
        assert zh['language'] == 'zh', zh['language']
        groups = {g.get('group'): g for g in zh['tabs'][0]['groups']}

        # 1. Untranslated pages are omitted, never emitted as the bare English path.
        assert groups['HasOne']['pages'] == ['zh/kept'], groups['HasOne']['pages']

        # 2. A group this pass emptied is dropped entirely.
        assert 'AllMissing' not in groups, 'emptied group should be dropped'

        # 3. A group already empty in English is preserved untouched.
        assert groups['EmptyInEnglish']['pages'] == [], 'English-empty group must survive'

        # 4. Pruning recurses, and an outer group survives if any inner one does.
        inner = {g.get('group'): g for g in groups['Outer']['groups']}
        assert inner['InnerKept']['pages'] == ['zh/nested/kept'], inner['InnerKept']
        assert 'InnerGone' not in inner, 'emptied nested group should be dropped'

        # 5. A metadata-only group has no children to lose, so it is kept.
        assert groups['MetaOnly']['icon'] == 'star', 'metadata-only group must survive'

        # 6. Nothing un-prefixed leaks into a localized tree.
        def walk(n, out):
            if isinstance(n, str):
                out.append(n)
            elif isinstance(n, list):
                for x in n:
                    walk(x, out)
            elif isinstance(n, dict):
                for k, v in n.items():
                    if k in ('pages', 'groups', 'tabs'):
                        walk(v, out)
        pages = []
        walk(zh['tabs'], pages)
        assert all(p.startswith('zh/') for p in pages), pages
    finally:
        resolves = real_resolves
    print('build-docs-langs selftest: all assertions passed')


if __name__ == '__main__':
    selftest() if '--selftest' in sys.argv else main()
