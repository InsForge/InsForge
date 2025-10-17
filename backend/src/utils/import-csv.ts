import { parse } from 'fast-csv';
import { Readable } from 'stream';
import { ColumnSchema, ColumnType } from '@insforge/shared-schemas';

export interface CSVImportResult {
  successCount: number;
  failedCount: number;
  failedRows: Array<{
    rowNumber: number;
    data: Record<string, unknown>;
    errors: string[];
  }>;
  warnings: string[];
}

export interface CSVValidationError {
  rowNumber: number;
  errors: string[];
}

export interface ParseOptions {
  tableName?: string;
  /**
   * Return true if value already exists in DB for given table.column.
   * If omitted, DB-level unique checks are skipped.
   */
  checkUnique?: (tableName: string, columnName: string, value: unknown) => boolean;
  /**
   * Return true if referenced FK value exists in referenced table.column.
   * If omitted, DB-level FK checks are skipped.
   */
  checkForeignKey?: (refTable: string, refColumn: string, value: unknown) => boolean;
}

/**
 * Validate CSV header names against a table schema.
 */
export function validateCSVHeaders(
  headers: string[],
  tableColumns: ColumnSchema[]
): { valid: boolean; errors: string[] } {
  const errors: string[] = [];
  const columnNames = tableColumns.map((col) => col.columnName);

  const unknownColumns = headers.filter((header) => !columnNames.includes(header));
  if (unknownColumns.length > 0) {
    errors.push(`Unknown columns in CSV: ${unknownColumns.join(', ')}`);
  }

  const requiredColumns = tableColumns.filter(
    (col) =>
      !col.isNullable &&
      col.defaultValue === undefined &&
      !['id', 'created_at', 'updated_at', 'createdAt', 'updatedAt'].includes(col.columnName)
  );
  const missingRequired = requiredColumns
    .map((col) => col.columnName)
    .filter((name) => !headers.includes(name));
  if (missingRequired.length > 0) {
    errors.push(`Missing required columns: ${missingRequired.join(', ')}`);
  }

  return {
    valid: errors.length === 0,
    errors,
  };
}

/**
 * Convert a CSV cell string into a typed value based on the provided column schema.
 */
export function convertCSVValue(
  value: string,
  columnSchema: ColumnSchema
): {
  success: boolean;
  value: unknown;
  error?: string;
} {
  if (value === undefined || value === null || String(value).trim() === '') {
    if (columnSchema.isNullable) {
      return { success: true, value: null };
    }
    if (columnSchema.defaultValue !== undefined) {
      // signal to caller to omit this column so DB default applies
      return { success: true, value: undefined };
    }
    return { success: false, value: null, error: `${columnSchema.columnName} cannot be empty` };
  }

  const v = String(value).trim();

  try {
    switch (columnSchema.type) {
      case ColumnType.STRING:
        return { success: true, value: v };

      case ColumnType.INTEGER: {
        const intVal = parseInt(v, 10);
        if (Number.isNaN(intVal)) {
          return { success: false, value: null, error: `Invalid integer value: ${v}` };
        }
        return { success: true, value: intVal };
      }

      case ColumnType.FLOAT: {
        const floatVal = parseFloat(v);
        if (Number.isNaN(floatVal)) {
          return { success: false, value: null, error: `Invalid float value: ${v}` };
        }
        return { success: true, value: floatVal };
      }

      case ColumnType.BOOLEAN: {
        const boolVal = v.toLowerCase();
        if (['true', '1', 'yes', 'y'].includes(boolVal)) {
          return { success: true, value: true };
        }
        if (['false', '0', 'no', 'n'].includes(boolVal)) {
          return { success: true, value: false };
        }
        return { success: false, value: null, error: `Invalid boolean value: ${v}` };
      }

      case ColumnType.DATETIME: {
        const date = new Date(v);
        if (Number.isNaN(date.getTime())) {
          return { success: false, value: null, error: `Invalid date value: ${v}` };
        }
        return { success: true, value: date.toISOString() };
      }

      case ColumnType.JSON:
        try {
          const parsed = JSON.parse(v);
          return { success: true, value: parsed };
        } catch {
          return { success: false, value: null, error: `Invalid JSON value: ${v}` };
        }

      case ColumnType.UUID: {
        const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
        if (!uuidRegex.test(v)) {
          return { success: false, value: null, error: `Invalid UUID value: ${v}` };
        }
        return { success: true, value: v.toLowerCase() };
      }

      default:
        return { success: true, value: v };
    }
  } catch (err) {
    return {
      success: false,
      value: null,
      error: `Type conversion error for ${columnSchema.columnName}: ${
        err instanceof Error ? err.message : 'Unknown error'
      }`,
    };
  }
}

/**
 * Parse and validate a CSV file against a table schema.
 * Validates: headers, types, nullable, in-file unique duplicates, optional DB UNIQUE and FK checks.
 */
export async function parseAndValidateCSV(
  fileBuffer: Buffer,
  tableColumns: ColumnSchema[],
  options: ParseOptions = {}
): Promise<{
  valid: boolean;
  headers: string[];
  rows: Array<Record<string, unknown>>;
  validationErrors: string[];
  rowErrors: CSVValidationError[];
}> {
  const rawRows: Array<{ rowNumber: number; data: Record<string, string> }> = [];
  const rows: Array<Record<string, unknown>> = [];
  let headers: string[] = [];
  const validationErrors: string[] = [];
  const rowErrors: CSVValidationError[] = [];
  let dataRowCounter = 0;

  const { tableName = '', checkUnique = () => false, checkForeignKey = () => true } = options;

  // Step 1: parse CSV into rawRows
  await new Promise<void>((resolve, reject) => {
    const stream = Readable.from([fileBuffer]);

    stream
      .pipe(
        parse({
          headers: true,
          trim: true,
        })
      )
      .on('headers', (parsedHeaders: string[]) => {
        headers = parsedHeaders.map((h) => String(h).trim());
        const headerValidation = validateCSVHeaders(headers, tableColumns);
        if (!headerValidation.valid) {
          validationErrors.push(...headerValidation.errors);
        }
      })
      .on('data', (row: Record<string, string>) => {
        dataRowCounter += 1;
        rawRows.push({
          rowNumber: dataRowCounter,
          data: row,
        });
      })
      .on('error', (error: Error) => {
        reject(
          new Error(
            `CSV parsing error: ${error.message}. Ensure the file has headers in the first row and is valid CSV.`
          )
        );
      })
      .on('end', () => {
        resolve();
      });
  });

  if (validationErrors.length > 0) {
    return {
      valid: false,
      headers,
      rows: [],
      validationErrors,
      rowErrors: [],
    };
  }

  // Prepare in-file duplicate detection sets for unique columns
  const uniqueColumns = tableColumns.filter((c) => c.isUnique).map((c) => c.columnName);
  const inFileValueSets: Record<string, Set<string>> = {};
  for (const colName of uniqueColumns) {
    inFileValueSets[colName] = new Set<string>();
  }

  // Step 2: validate each row with conversions and constraint checks
  for (const raw of rawRows) {
    const { rowNumber, data } = raw;
    const errors: string[] = [];
    const convertedRow: Record<string, unknown> = {};

    for (const header of headers) {
      const columnSchema = tableColumns.find((col) => col.columnName === header);
      if (!columnSchema) {
        // unknown header already reported in header validation
        continue;
      }

      // Skip system columns from CSV processing
      if (['id', 'created_at', 'updated_at', 'createdAt', 'updatedAt'].includes(header)) {
        continue;
      }

      const rawValue = data[header] ?? '';
      const conversion = convertCSVValue(rawValue, columnSchema);

      if (!conversion.success) {
        errors.push(`Column "${header}": ${conversion.error || 'Conversion failed'}`);
        continue;
      }

      const value = conversion.value;

      // Nullable constraint: null or undefined while column is not nullable and no default
      if (
        (value === null || value === undefined) &&
        !columnSchema.isNullable &&
        columnSchema.defaultValue === undefined
      ) {
        errors.push(`Column "${header}" cannot be null or empty`);
        continue;
      }

      // In-file duplicate detection for UNIQUE columns
      if (columnSchema.isUnique && value !== null && value !== undefined) {
        const key = String(value);
        if (inFileValueSets[header].has(key)) {
          errors.push(`Duplicate value in uploaded CSV for unique column "${header}": ${key}`);
        } else {
          inFileValueSets[header].add(key);
        }
      }

      // DB-level UNIQUE check (optional)
      if (columnSchema.isUnique && value !== null && value !== undefined) {
        try {
          const exists = checkUnique(tableName, header, value);
          if (exists) {
            errors.push(
              `Value already exists in database for unique column "${header}": ${String(value)}`
            );
          }
        } catch (dbErr) {
          errors.push(
            `Failed to validate uniqueness for column "${header}": ${dbErr instanceof Error ? dbErr.message : 'Unknown error'}`
          );
        }
      }

      // Foreign key validation if foreignKey info present on schema
      if (columnSchema.foreignKey && value !== null && value !== undefined) {
        const fk = columnSchema.foreignKey;
        const refTable = fk.referenceTable;
        const refColumn = fk.referenceColumn || 'id';

        try {
          const fkExists = checkForeignKey(refTable, refColumn, value);
          if (!fkExists) {
            errors.push(
              `Foreign key constraint failed for column "${header}": referenced ${refTable}.${refColumn} value "${String(
                value
              )}" does not exist`
            );
          }
        } catch (fkErr) {
          errors.push(
            `Failed to validate foreign key for column "${header}": ${fkErr instanceof Error ? fkErr.message : 'Unknown error'}`
          );
        }
      }

      // If conversion returned undefined, omit the key to allow DB default
      if (conversion.success && conversion.value !== undefined) {
        convertedRow[header] = conversion.value;
      }
    }

    if (errors.length > 0) {
      rowErrors.push({
        rowNumber,
        errors,
      });
    } else {
      rows.push(convertedRow);
    }
  }

  return {
    valid: validationErrors.length === 0 && rowErrors.length === 0,
    headers,
    rows,
    validationErrors,
    rowErrors,
  };
}
