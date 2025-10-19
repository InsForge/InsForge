import { jsonSchema } from '@/lib/utils/validation-schemas';
import { ColumnSchema, ColumnType } from '@insforge/shared-schemas';
import { z } from 'zod';

export const SYSTEM_FIELDS = ['id', 'created_at', 'updated_at'];

// Helper function to build dynamic Zod schema based on column definitions
export function buildDynamicSchema(columns: ColumnSchema[]) {
  const schemaFields: Record<string, z.ZodTypeAny> = {};

  columns.forEach((column) => {
    // Skip system fields
    if (SYSTEM_FIELDS.includes(column.columnName)) {
      return;
    }

    let fieldSchema;

    switch (column.type) {
      case ColumnType.STRING:
        fieldSchema = z.string();
        if (!column.isNullable) {
          fieldSchema = fieldSchema.min(1, `${column.columnName} is required`);
        }
        break;
      case ColumnType.INTEGER:
        fieldSchema = z.number().int();
        if (column.isNullable) {
          fieldSchema = fieldSchema.nullable().optional();
        }
        break;
      case ColumnType.FLOAT:
        fieldSchema = z.number();
        if (column.isNullable) {
          fieldSchema = fieldSchema.nullable().optional();
        }
        break;
      case ColumnType.BOOLEAN:
        fieldSchema = z.boolean();
        if (column.isNullable) {
          fieldSchema = fieldSchema.nullable().optional();
        }
        break;
      case ColumnType.DATE:
        fieldSchema = z.string();
        if (column.isNullable) {
          fieldSchema = fieldSchema.nullable().optional();
        }
        break;
      case ColumnType.DATETIME:
        fieldSchema = z.string(); // ISO date string
        if (column.isNullable) {
          fieldSchema = fieldSchema.nullable().optional();
        }
        break;
      case ColumnType.JSON:
        fieldSchema = jsonSchema;
        if (column.isNullable) {
          fieldSchema = fieldSchema.nullable().optional();
        }
        break;
      default:
        fieldSchema = z.unknown();
        if (column.isNullable) {
          fieldSchema = fieldSchema.nullable().optional();
        }
    }

    schemaFields[column.columnName] = fieldSchema;
  });

  return z.object(schemaFields);
}

// Get initial values for form based on column definitions
export function getInitialValues(columns: ColumnSchema[]): Record<string, unknown> {
  const values: Record<string, unknown> = {};

  columns.forEach((column) => {
    // Skip auto-generated fields
    if (SYSTEM_FIELDS.includes(column.columnName)) {
      return;
    }

    // Set default values based on type and defaultValue setting
    switch (column.type) {
      case ColumnType.BOOLEAN:
        values[column.columnName] = column.defaultValue
          ? Boolean(column.defaultValue)
          : column.isNullable
            ? null
            : false;
        break;
      case ColumnType.INTEGER:
        if (column.defaultValue !== undefined) {
          values[column.columnName] = parseInt(column.defaultValue, 10);
        }
        break;
      case ColumnType.FLOAT:
        if (column.defaultValue !== undefined) {
          values[column.columnName] = parseFloat(column.defaultValue);
        }
        break;
      case ColumnType.UUID:
        if (column.defaultValue && !column.defaultValue.endsWith('()')) {
          // Static UUID default value
          values[column.columnName] = column.defaultValue;
        } else {
          // For gen_random_uuid() or no default, leave empty - will be generated on submit
          values[column.columnName] = '';
        }
        break;
      case ColumnType.STRING:
      case ColumnType.DATE:
      case ColumnType.DATETIME:
      case ColumnType.JSON:
        values[column.columnName] = column.defaultValue ?? '';
        break;
      default:
        values[column.columnName] = '';
    }
  });

  return values;
}
