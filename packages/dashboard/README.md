# @insforge/dashboard

Shared InsForge dashboard package.

This package is the source of truth for dashboard UI and feature behavior used by:

- the self-hosting dashboard app inside `frontend/` in this repo
- the `insforge-cloud` repo

## Package role

- `packages/dashboard/`: shared dashboard routes, features, host contract types, and styling
- `frontend/`: local host shell that mounts this package in self-hosting mode

## Entry points

- Package exports: `src/index.ts`
- Dashboard app root: `src/app/InsforgeDashboard.tsx`
- Main route tree: `src/router/AppRoutes.tsx`

## Validation

Run package-level checks when editing this package:

```bash
npm --workspace @insforge/dashboard run typecheck
npm --workspace @insforge/dashboard run test:unit
npm --workspace @insforge/dashboard run test:component
```
