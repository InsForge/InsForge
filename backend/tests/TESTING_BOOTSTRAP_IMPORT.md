# Testing the Bootstrap Migrations Import

This document explains how to test that the `bootstrap-migrations.js` file can successfully import the logger from `src/utils/logger.ts`.

## Problem


The concern was that `bootstrap-migrations.js` (a JavaScript file) imports `logger.ts` (a TypeScript file) using the path `../../../../utils/logger.js`, which might fail at runtime.

## Solution

The import works because:
1. The script is run with `tsx` (not plain `node`), which can handle TypeScript imports
2. The relative path `../../../../utils/logger.js` correctly resolves to `src/utils/logger.ts`
3. The `.js` extension in the import is correct (TypeScript convention - you use `.js` in imports even for `.ts` files)

## How to Test

### Option 1: Run the Unit Test

```bash
cd backend
npm test tests/unit/bootstrap-migrations-import.test.ts
```

Or use the dedicated test script:

```bash
cd backend
npm run test:bootstrap-import
```

This runs the automated test in `tests/unit/bootstrap-migrations-import.test.ts` which:
- Verifies the logger can be imported successfully
- Verifies all logger methods (info, error, warn) are available
- Verifies the relative path calculation is correct

### Option 2: Run the Verification Script

```bash
cd backend
npm run test:bootstrap-import
```

This runs `tests/verify-bootstrap-import.js` which:
- Tests the exact import path
- Verifies logger methods work
- Provides clear success/failure output

### Option 3: Test the Actual Bootstrap Script

To test that the bootstrap script itself works (without actually running migrations):

```bash
cd backend

# Set a dummy DATABASE_URL to test the import (it will fail on connection, but import will work)
# On Unix/Mac:
DATABASE_URL="postgresql://test:test@localhost:5432/test" npm run migrate:bootstrap

# On Windows PowerShell:
$env:DATABASE_URL="postgresql://test:test@localhost:5432/test"; npm run migrate:bootstrap
```

If the import fails, you'll see an import error. If it succeeds, you'll see a database connection error (which is expected with a dummy URL), but the import will have worked.

### Option 4: Manual Verification

You can also manually verify the path calculation:

1. **From**: `src/infra/database/migrations/bootstrap/bootstrap-migrations.js`
2. **To**: `src/utils/logger.ts`
3. **Path calculation**:
   - `../` → `src/infra/database/migrations/`
   - `../../` → `src/infra/database/`
   - `../../../` → `src/infra/`
   - `../../../../` → `src/`
   - `../../../../utils/logger.js` → `src/utils/logger.ts` ✓

## Expected Results

All tests should pass, confirming:
- The import path is correct
- The logger can be imported from a JavaScript file when run with `tsx`
- All logger methods are available and functional

## What Changed

1. **package.json**: Changed `migrate:bootstrap` script from `node` to `tsx` to enable TypeScript imports
2. **bootstrap-migrations.js**: Added comment explaining why the import works
3. **Tests**: Added automated tests to verify the import works

