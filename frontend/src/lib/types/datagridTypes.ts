import { ColumnType } from '@insforge/shared-schemas';

/**
 * Raw database values - these are the actual data types stored in the database
 * and received from the backend API. These match the ConvertedValue type.
 */
export type DatabaseValue =
  | string // STRING, UUID, DATETIME (as ISO string)
  | number // INTEGER, FLOAT
  | boolean // BOOLEAN
  | null // NULL values for any nullable column
  | JSON; // JSON (as parsed object or string)

/**
 * User input values - these are the values users enter in forms and cell editors
 * All user inputs start as strings and need to be converted to DatabaseValue
 */
export type UserInputValue = string | number | boolean | null;

/**
 * Display values - these are always strings formatted for UI display
 * Used by cell renderers and form display components
 */
export type DisplayValue = string;

/**
 * Database record type - represents a row in the database
 */
export interface DatabaseRecord {
  [columnName: string]: DatabaseValue;
}

/**
 * Cell renderer props for DataGrid components
 */
export interface CellRendererProps {
  row: DatabaseRecord;
  column: {
    key: string;
    name: string;
  };
  options?: {
    getVariant?: (value: DatabaseValue) => 'default' | 'destructive' | 'outline' | 'secondary';
    getLabel?: (value: DatabaseValue) => string;
  };
}

/**
 * Form field value change handler
 */
export type FormFieldChangeHandler = (value: DatabaseValue) => void;

/**
 * Cell edit handler for DataGrid
 */
export type CellEditHandler = (
  rowId: string,
  columnKey: string,
  newValue: DatabaseValue
) => Promise<void>;

/**
 * Value conversion result for user input validation
 */
export type ValueConversionResult =
  | { success: true; value: DatabaseValue }
  | { success: false; error: string };

/**
 * Format options for display value formatting
 */
export interface ValueFormatOptions {
  /** Locale for date formatting (default: 'en-US') */
  locale?: string;
  /** Date format options */
  dateOptions?: Intl.DateTimeFormatOptions;
  /** Show null as 'null' string or empty string */
  showNullAsString?: boolean;
  /** Truncate long strings/JSON to this length */
  maxLength?: number;
}

/**
 * Type guard to check if a value is a valid DatabaseValue
 */
export function isDatabaseValue(value: unknown): value is DatabaseValue {
  return (
    typeof value === 'string' ||
    typeof value === 'number' ||
    typeof value === 'boolean' ||
    value === null ||
    (typeof value === 'object' && value !== null)
  );
}

/**
 * Type guard to check if a column type is datetime-related
 */
export function isDateTimeColumn(type: ColumnType): boolean {
  return type === ColumnType.DATETIME;
}

/**
 * Type guard to check if a column type is numeric
 */
export function isNumericColumn(type: ColumnType): boolean {
  return type === ColumnType.INTEGER || type === ColumnType.FLOAT;
}

/**
 * Type guard to check if a column type is JSON
 */
export function isJsonColumn(type: ColumnType): boolean {
  return type === ColumnType.JSON;
}
