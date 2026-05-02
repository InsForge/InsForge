# QA Report: Auto-Confirm User Creation (InsForge #989)

**Date:** 2026-03-31
**Branch:** feat/auto-confirm-user-creation
**Mode:** Code-level QA (no running instance available — OSS contribution)
**Duration:** ~5 minutes

## Summary

| Metric | Result |
|--------|--------|
| Unit tests | 4/4 passing (new) |
| Regression tests | 340/340 passing (all existing) |
| Frontend TypeScript | Pre-existing errors only (CodeMirror types), none from our changes |
| Backend lint | Clean |
| Files changed | 7 |

## Test Coverage

### Backend (auth.service.ts → register())

| Scenario | Expected | Tested | Result |
|----------|----------|--------|--------|
| autoConfirm=true + admin | email_verified=true in DB | ✅ | PASS |
| autoConfirm=false + admin | email_verified=false | ✅ | PASS |
| autoConfirm=true + non-admin | autoConfirm ignored | ✅ | PASS |
| autoConfirm omitted | Existing behavior unchanged | ✅ | PASS |
| autoConfirm in schema | z.boolean().optional() | ✅ | Validates correctly |

### Frontend (UserFormDialog.tsx)

| Scenario | Expected | Verified |
|----------|----------|----------|
| Switch visible in create mode | Auto-confirm toggle shown | ✅ Code review: `!user` guard |
| Switch hidden in edit mode | No toggle when editing user | ✅ Code review: `{!user && (...)}` |
| Default state | Switch off (unchecked) | ✅ `useState(false)` |
| Reset on dialog open | Switch resets to off | ✅ `useEffect` resets state |
| Value sent to API | `true` or omitted (not `false`) | ✅ `autoConfirm === true ? true : undefined` |

### Route handler (auth/index.routes.ts)

| Scenario | Expected | Verified |
|----------|----------|----------|
| Admin token present | autoConfirm passed to service | ✅ Code review |
| No admin token | autoConfirm forced to false | ✅ `adminCreatingUser ? body.autoConfirm : false` |
| Invalid admin token | Falls through to non-admin path | ✅ try/catch sets `adminCreatingUser = false` |

### Data flow (end-to-end)

```
UserFormDialog (autoConfirm: boolean)
  → user.service.ts (POST body includes autoConfirm)
    → auth/index.routes.ts (gates behind admin token)
      → auth.service.ts (INSERT with email_verified = autoConfirm && isAdmin)
        → DB: auth.users.email_verified = true/false
```

All 5 layers verified via unit tests + code review.

## Security Verification

| Check | Status |
|-------|--------|
| autoConfirm gated behind admin JWT | ✅ Route-level guard |
| Non-admin requests can't auto-confirm | ✅ Tested explicitly |
| Schema accepts but route strips for non-admins | ✅ Defense-in-depth |
| No new permissions required | ✅ Existing admin role sufficient |

## Regressions

**0 regressions found.** All 340 existing tests pass. The only behavioral change is:
- Admin-created users with autoConfirm=true now get `email_verified=true` (previously always false)
- This is the intended new behavior, not a regression

## Issues Found

**0 issues found.**

## Health Score

Not applicable — no running instance to browser-test. Code-level QA confidence: **HIGH**.

## Recommendation

PR is ready for maintainer review. The feature is well-tested, security-gated, and backwards-compatible (default is off).
