# Python and Go SDK Implementation Plan

> **For maintainers and contributors:** issue [#785](https://github.com/InsForge/InsForge/issues/785) is too large to land as a single monorepo change. This document breaks the work into phases, keeps the current OpenAPI specs as the contract source of truth, and calls out which features can be generated versus which need handwritten runtime support.

**Goal:** ship official Python and Go SDKs for InsForge without blocking current product work in the monorepo.

**Recommended repository strategy:** keep the API contract and examples in `InsForge/InsForge`, but publish each SDK from its own repository:
- `insforge-python`
- `insforge-go`

This matches the maintainer note on the issue that the implementation may belong in a separate repo, while still letting this repository own the product API shape through the existing OpenAPI specs.

## Phase 0: Contract readiness

Before creating either SDK repo, confirm the OpenAPI surface is stable enough for generation.

**Checklist:**
- Audit the existing specs in `openapi/` for naming consistency, response envelopes, auth descriptions, and reusable schemas.
- Add missing examples for common auth, database, storage, functions, AI, and realtime flows.
- Mark endpoints that should not be part of public SDK ergonomics.
- Decide whether SDKs will target a merged OpenAPI bundle or stay split by product area.

**Deliverable:** a documented contract baseline that both SDK repos can generate from.

## Phase 1: Shared SDK architecture

Build both SDKs around the same product model:

- **Core client config**
  - `base_url`
  - `anon_key`
  - optional `service_role_key`
  - request timeout
  - custom headers
- **Auth-aware transport**
  - bearer token injection
  - cookie/session friendly flows where applicable
  - refresh/session helpers when the backend supports them cleanly outside the browser
- **Service modules**
  - `database`
  - `auth`
  - `storage`
  - `functions`
  - `ai`
  - `realtime`
- **Consistent result model**
  - Python: raise typed exceptions for transport and API failures
  - Go: return `(result, error)` with structured error types

**Design choice:** use generated low-level API clients plus a handwritten high-level facade. Pure generation will expose the endpoints quickly, but handwritten wrappers are still needed to make the SDKs feel like InsForge rather than raw REST bindings.

## Phase 2: MVP scope

The first public release for both SDKs should cover the APIs that map well to HTTP request/response flows:

1. **Database**
   - select, insert, update, upsert, delete
   - filters, ordering, pagination
   - typed row decoding where possible
2. **Authentication**
   - sign up
   - sign in
   - sign out
   - current user/session lookup
   - OAuth URL helpers if they can be represented cleanly outside browser-only redirects
3. **Storage**
   - upload
   - download
   - signed URL creation/consumption helpers
   - list and delete objects
4. **Functions**
   - invoke edge functions
   - pass JSON, text, and binary payloads
5. **AI**
   - chat completions
   - embeddings
   - image generation if the endpoint contract is stable

**Explicitly defer from MVP unless already trivial:**
- full realtime channel abstraction
- admin-only APIs that are not meant for application developers
- UI helpers and framework bindings

## Phase 3: Language-specific repo plan

### Python SDK

**Suggested stack:**
- Python 3.10+
- `httpx` for sync/async transport
- `pydantic` for models
- `pytest` for tests
- `ruff` and `mypy` for quality gates

**Package shape:**
- `insforge/__init__.py`
- `insforge/client.py`
- `insforge/auth.py`
- `insforge/database.py`
- `insforge/storage.py`
- `insforge/functions.py`
- `insforge/ai.py`
- `insforge/realtime.py`
- `insforge/errors.py`

**Release target:** PyPI with semantic versioning aligned to the public API contract, not necessarily the monorepo patch number.

### Go SDK

**Suggested stack:**
- Go 1.24+
- standard library `net/http` plus typed request helpers
- generated models where useful, but keep public facades idiomatic
- `testing` plus table-driven tests

**Package shape:**
- `client`
- `auth`
- `database`
- `storage`
- `functions`
- `ai`
- `realtime`
- `internal/generated`

**Release target:** versioned Go module tags.

## Phase 4: Realtime support

Realtime is the least likely area to fit cleanly into OpenAPI-only generation.

**Recommendation:**
- ship MVP without a rich realtime abstraction
- add realtime as a second milestone with handwritten WebSocket or Socket.IO client support
- define subscription lifecycle, reconnect behavior, auth propagation, and callback ergonomics separately for Python and Go

This avoids blocking the core SDKs on the most stateful feature.

## Phase 5: Testing and release process

Each SDK repo should validate against a real InsForge instance in CI.

**Required coverage:**
- local smoke tests against a docker-compose InsForge environment
- contract tests for auth, database, storage, functions, and AI
- generated-client regeneration check when OpenAPI changes
- example apps or snippets that run in CI where practical

**Monorepo coordination:**
- when `openapi/*.yaml` changes in a breaking way, open follow-up regeneration PRs in the SDK repos
- document SDK impact in PR descriptions for API changes

## Suggested delivery order

1. Finalize the OpenAPI contract baseline in this repo.
2. Stand up `insforge-python` with generated low-level client plus handwritten facade.
3. Reach MVP parity for database, auth, storage, functions, and AI in Python.
4. Repeat the same pattern for `insforge-go`.
5. Add realtime support after both SDKs have stable HTTP coverage.

## Open questions for maintainers

- Should Python and Go ship from separate repositories immediately, or begin in a temporary `sdk-experiments` workspace first?
- Should the SDKs expose browser-style session refresh semantics, or focus on server-side and CLI usage first?
- Is realtime required for the first stable release, or acceptable as a follow-up milestone?
- Should the monorepo publish a bundled OpenAPI artifact to simplify downstream generation?

## Success criteria

This plan is successful when:

- maintainers agree on the repository strategy
- contributors have a phased implementation order
- OpenAPI becomes the explicit contract source for non-TypeScript SDKs
- Python and Go work can proceed incrementally instead of being treated as one oversized issue
