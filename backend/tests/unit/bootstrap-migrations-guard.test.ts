import { describe, it, expect } from 'vitest';
import { shouldRefuseReplay } from '@/infra/database/migrations/bootstrap/bootstrap-migrations.js';
import { readMigrationNames } from '@/infra/database/migrations/bootstrap/baseline-migrations.js';

// Guards the regression where a database restored without its system.migrations
// ledger (empty ledger, fully-provisioned schema) caused node-pg-migrate to
// replay every migration from 000 and crash on the non-idempotent 018.
describe('bootstrap migration ledger guard', () => {
  describe('shouldRefuseReplay', () => {
    it('refuses replay when the ledger is empty but the schema is already provisioned', () => {
      expect(
        shouldRefuseReplay({ ledgerTableExists: true, ledgerRowCount: 0, schemaProvisioned: true })
      ).toBe(true);
    });

    it('allows a genuine fresh install (empty ledger, unprovisioned schema)', () => {
      expect(
        shouldRefuseReplay({ ledgerTableExists: true, ledgerRowCount: 0, schemaProvisioned: false })
      ).toBe(false);
    });

    it('allows a normal boot when the ledger already has rows', () => {
      expect(
        shouldRefuseReplay({ ledgerTableExists: true, ledgerRowCount: 48, schemaProvisioned: true })
      ).toBe(false);
    });

    it('does not fire before the ledger table exists', () => {
      expect(
        shouldRefuseReplay({ ledgerTableExists: false, ledgerRowCount: 0, schemaProvisioned: true })
      ).toBe(false);
    });
  });

  describe('readMigrationNames (baseline)', () => {
    const names = readMigrationNames();

    it('returns migration names without the .sql extension or any path', () => {
      expect(names.length).toBeGreaterThan(0);
      expect(names.every((n) => !n.endsWith('.sql') && !n.includes('/'))).toBe(true);
    });

    it('is lexicographically sorted (matching node-pg-migrate ordering)', () => {
      expect(names).toEqual([...names].sort());
    });

    it('includes known migrations in the ledger name format', () => {
      expect(names).toContain('000_create-base-tables');
      expect(names).toContain('018_schema-rework');
    });
  });
});
