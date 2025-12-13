import { ColumnType } from '@insforge/shared-schemas';
import type {
  Column,
  RenderCellProps,
  RenderEditCellProps,
  RenderHeaderCellProps,
} from 'react-data-grid';

/**
 * Raw database values - these are the actual data types stored in the database
 * and received from the backend API.
 */
export type ConvertedValue =
  | string // STRING, UUID, DATETIME, DATE (as ISO string)
  | number // INTEGER, FLOAT
  | boolean // BOOLEAN
  | null // NULL values for any nullable column
  | JSON // JSON (as parsed object or string)
  | Record<string, unknown> // JSON objects (e.g., metadata fields)
  | string[]; // Array of strings (e.g., providers)

/**
 * User input values - these are the types of values users enter in forms and cell editors
 * All user inputs need to be converted to ConvertedValue
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
  [columnName: string]: ConvertedValue | { [key: string]: string }[];
}

/**
 * DataGrid row data - extends DatabaseRecord with required id
 */
export interface DataGridRow extends DatabaseRecord {
  id: string;
}

/**
 * Generic row type that can be either a DatabaseRecord or a specific schema
 * This allows us to support both AI-generated tables and predefined schemas
 * The id field is optional as react-data-grid can generate it automatically
 */
export type DataGridRowType = DatabaseRecord & { id?: string };

/**
 * DataGrid column definition - generic version that extends react-data-grid's Column
 * TRow must extend DataGridRowType to ensure it has both id and index signature
 */
export interface DataGridColumn<TRow extends DataGridRowType = DataGridRow> extends Column<TRow> {
  type?: ColumnType;
  isPrimaryKey?: boolean;
  isNullable?: boolean;
  // Override render functions to use our custom prop types
  renderCell?: (props: RenderCellProps<TRow>) => React.ReactNode;
  renderEditCell?: (props: RenderEditCellProps<TRow>) => React.ReactNode;
  renderHeaderCell?: (props: RenderHeaderCellProps<TRow>) => React.ReactNode;
}

/**
 * Value conversion result for user input validation
 */
export type ValueConversionResult =
  | { success: true; value: ConvertedValue }
  | { success: false; error: string };
