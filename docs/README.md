# InsForge Documentation

This directory contains the public documentation source for InsForge.

## Main areas

- `core-concepts/`: product architecture and feature behavior
- `sdks/`: SDK usage guides by language
- `agent-docs/`: agent-oriented execution docs
- `examples/`: framework and integration examples
- `docs.json`: Mintlify site configuration and navigation
- `../openapi/*.yaml`: API reference specs used by docs navigation

## Local preview

Install the [Mintlify CLI](https://www.npmjs.com/package/mint):

```bash
npm i -g mint
```

Run from `docs/`:

```bash
mint dev
```

View your local preview at `http://localhost:3000`.

## Contributor notes

- Keep `docs.json` navigation and file paths in sync.
- If API request or response shapes change, update the matching OpenAPI spec under `../openapi/`.
- If backend docs endpoints change, update `../backend/src/api/routes/docs/index.routes.ts` mappings.
