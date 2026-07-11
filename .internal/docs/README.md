# Internal docs

Home for working documents that support development but are not part of the published documentation. Nothing in this tree is referenced by `docs/docs.json` or shipped to the docs site.

## Where a document belongs

| Kind of document | Location |
| --- | --- |
| Implementation plans | `.internal/docs/plans/` |
| Design specs | `.internal/docs/specs/` |
| Audits and reviews | `.internal/docs/audits/` |
| Agent-facing reference | `.agents/docs/` |
| Deprecated / superseded material | `.archive/docs/deprecated/` |
| User-facing documentation | `docs/` (must be reachable from `docs/docs.json` navigation) |

## The rule

`docs/` is the public Mintlify tree: every `.mdx`/`.md` page there (outside `snippets/` and repo housekeeping like `README.md`) should be reachable from `docs/docs.json`. Plans, specs, audits, and other internal working files go under `.internal/docs/` — never under `docs/` — even when they relate to a documentation feature.

Established in #1400 / PR #1433; this README exists so future audits have a convention to point at.
