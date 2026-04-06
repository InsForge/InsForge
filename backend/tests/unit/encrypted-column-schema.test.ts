import { describe, test, expect } from 'vitest';
import {
  validatedColumnSchema,
  tableSchema,
} from '@insforge/shared-schemas';
import {
  createTableRequestSchema,
  updateTableSchemaRequestSchema,
} from '@insforge/shared-schemas';

describe('Encrypted column schema validation', () => {
  // ========================
  // validatedColumnSchema
  // ========================
  describe('validatedColumnSchema', () => {
    test('accepts a normal encrypted column', () => {
      const result = validatedColumnSchema.safeParse({
        columnName: 'secret_data',
        type: 'string',
        isNullable: true,
        isUnique: false,
        encrypted: true,
      });
      expect(result.success).toBe(true);
    });

    test('rejects encrypted column with isPrimaryKey', () => {
      const result = validatedColumnSchema.safeParse({
        columnName: 'secret_data',
        type: 'string',
        isNullable: false,
        isUnique: false,
        isPrimaryKey: true,
        encrypted: true,
      });
      expect(result.success).toBe(false);
      if (!result.success) {
        const messages = result.error.issues.map((i) => i.message);
        expect(messages).toContain('Encrypted columns cannot be primary keys');
      }
    });

    test('rejects encrypted column with isUnique', () => {
      const result = validatedColumnSchema.safeParse({
        columnName: 'email_encrypted',
        type: 'string',
        isNullable: false,
        isUnique: true,
        encrypted: true,
      });
      expect(result.success).toBe(false);
      if (!result.success) {
        const messages = result.error.issues.map((i) => i.message);
        expect(messages).toContain('Encrypted columns cannot have a unique constraint');
      }
    });

    test('rejects encrypted column with foreignKey', () => {
      const result = validatedColumnSchema.safeParse({
        columnName: 'user_ref',
        type: 'uuid',
        isNullable: false,
        isUnique: false,
        encrypted: true,
        foreignKey: {
          referenceTable: 'users',
          referenceColumn: 'id',
          onDelete: 'CASCADE',
          onUpdate: 'CASCADE',
        },
      });
      expect(result.success).toBe(false);
      if (!result.success) {
        const messages = result.error.issues.map((i) => i.message);
        expect(messages).toContain('Encrypted columns cannot have foreign key references');
      }
    });

    test('allows isPrimaryKey + isUnique when NOT encrypted', () => {
      const result = validatedColumnSchema.safeParse({
        columnName: 'id',
        type: 'uuid',
        isNullable: false,
        isUnique: true,
        isPrimaryKey: true,
      });
      expect(result.success).toBe(true);
    });

    test('reports all issues when multiple violations exist', () => {
      const result = validatedColumnSchema.safeParse({
        columnName: 'bad_col',
        type: 'string',
        isNullable: false,
        isUnique: true,
        isPrimaryKey: true,
        encrypted: true,
      });
      expect(result.success).toBe(false);
      if (!result.success) {
        // Should have at least 2 issues (PK + unique)
        expect(result.error.issues.length).toBeGreaterThanOrEqual(2);
      }
    });
  });

  // ========================
  // tableSchema inherits validatedColumnSchema
  // ========================
  describe('tableSchema uses validatedColumnSchema', () => {
    test('rejects table with encrypted PK column', () => {
      const result = tableSchema.safeParse({
        tableName: 'test_table',
        columns: [
          {
            columnName: 'secret_key',
            type: 'string',
            isNullable: false,
            isUnique: false,
            isPrimaryKey: true,
            encrypted: true,
          },
        ],
      });
      expect(result.success).toBe(false);
    });

    test('accepts table with valid encrypted column', () => {
      const result = tableSchema.safeParse({
        tableName: 'test_table',
        columns: [
          {
            columnName: 'secret',
            type: 'string',
            isNullable: true,
            isUnique: false,
            encrypted: true,
          },
        ],
      });
      expect(result.success).toBe(true);
    });
  });

  // ========================
  // createTableRequestSchema inherits via tableSchema
  // ========================
  describe('createTableRequestSchema uses validatedColumnSchema', () => {
    test('rejects create-table with encrypted unique column', () => {
      const result = createTableRequestSchema.safeParse({
        tableName: 'users',
        columns: [
          {
            columnName: 'ssn',
            type: 'string',
            isNullable: false,
            isUnique: true,
            encrypted: true,
          },
        ],
      });
      expect(result.success).toBe(false);
    });
  });

  // ========================
  // updateTableSchemaRequestSchema.addColumns
  // ========================
  describe('updateTableSchemaRequestSchema uses validatedColumnSchema for addColumns', () => {
    test('rejects addColumns with encrypted PK', () => {
      const result = updateTableSchemaRequestSchema.safeParse({
        addColumns: [
          {
            columnName: 'secret',
            type: 'string',
            isNullable: false,
            isUnique: false,
            isPrimaryKey: true,
            encrypted: true,
          },
        ],
      });
      expect(result.success).toBe(false);
    });

    test('rejects addColumns with encrypted unique', () => {
      const result = updateTableSchemaRequestSchema.safeParse({
        addColumns: [
          {
            columnName: 'secret',
            type: 'string',
            isNullable: false,
            isUnique: true,
            encrypted: true,
          },
        ],
      });
      expect(result.success).toBe(false);
    });

    test('accepts addColumns with valid encrypted column', () => {
      const result = updateTableSchemaRequestSchema.safeParse({
        addColumns: [
          {
            columnName: 'secret',
            type: 'string',
            isNullable: true,
            isUnique: false,
            encrypted: true,
          },
        ],
      });
      expect(result.success).toBe(true);
    });
  });
});
