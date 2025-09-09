import { ColumnType } from '@insforge/shared-schemas';
import { type ClassValue, clsx } from 'clsx';
import { twMerge } from 'tailwind-merge';
import { format } from 'date-fns';
import { z } from 'zod';
import {
  uuidSchema,
  integerSchema,
  floatSchema,
  booleanSchema,
  dateTimeSchema,
  jsonSchema,
  stringSchema,
} from './validation-schemas';
import type {
  DatabaseValue,
  UserInputValue,
  DisplayValue,
  ValueConversionResult,
  ValueFormatOptions,
} from '@/components/datagrid';

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

// Keep ConvertedValue for the existing convertValueForColumn function
export type ConvertedValue = string | number | boolean | null | JSON;

/**
 * Convert and validate a user input value based on the specified ColumnType
 * This function converts string inputs from forms/editors to proper database values
 */
export function convertValueForColumn(
  type: ColumnType,
  value: UserInputValue
): ValueConversionResult {
  try {
    let convertedValue;

    switch (type) {
      case ColumnType.UUID:
        convertedValue = uuidSchema.parse(value);
        break;
      case ColumnType.INTEGER:
        convertedValue = integerSchema.parse(value);
        break;
      case ColumnType.FLOAT:
        convertedValue = floatSchema.parse(value);
        break;
      case ColumnType.BOOLEAN:
        convertedValue = booleanSchema.parse(value);
        break;
      case ColumnType.DATETIME:
        convertedValue = dateTimeSchema.parse(value);
        break;
      case ColumnType.JSON:
        convertedValue = jsonSchema.parse(value);
        break;
      case ColumnType.STRING:
        convertedValue = stringSchema.parse(value);
        break;
      default:
        return {
          success: false,
          error: `Unsupported column type: ${type}`,
        };
    }

    return {
      success: true,
      value: convertedValue,
    };
  } catch (error) {
    if (error instanceof z.ZodError) {
      return {
        success: false,
        error: error.errors[0]?.message || 'Validation failed',
      };
    }
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Unknown conversion error',
    };
  }
}

/**
 * Check if a value is considered empty for database purposes
 */
export function isEmptyValue(value: unknown): boolean {
  return value === null || value === undefined || value === '';
}

/**
 * Centralized value formatter that handles all data types consistently
 * Converts database values to formatted display strings for UI components
 */
export function formatValueForDisplay(
  value: DatabaseValue,
  type?: ColumnType,
  options: ValueFormatOptions = {}
): DisplayValue {
  const { dateFormat = 'MMM dd, yyyy h:mm a', maxLength } = options;

  // Handle null/undefined values
  if (isEmptyValue(value)) {
    return 'null';
  }

  // Handle different column types
  switch (type) {
    case ColumnType.BOOLEAN:
      return value ? 'true' : 'false';

    case ColumnType.DATETIME: {
      const date =
        value instanceof Date
          ? value
          : typeof value === 'string' || typeof value === 'number'
            ? new Date(value)
            : null;

      if (!date || Number.isNaN(date.getTime())) {
        return 'Invalid date';
      }

      // Use date-fns format for consistent, readable formatting
      const formatted = format(date, dateFormat);
      return maxLength ? truncateString(formatted, maxLength) : formatted;
    }

    case ColumnType.JSON: {
      try {
        let parsed: unknown;

        if (typeof value === 'string') {
          parsed = JSON.parse(value);
        } else {
          parsed = value;
        }

        const formatted =
          parsed && typeof parsed === 'object' ? JSON.stringify(parsed) : String(parsed);

        return maxLength ? truncateString(formatted, maxLength) : formatted;
      } catch {
        return 'Invalid JSON';
      }
    }

    case ColumnType.INTEGER:
    case ColumnType.FLOAT: {
      const num = Number(value);
      return Number.isNaN(num) ? String(value) : String(num);
    }

    case ColumnType.UUID:
    case ColumnType.STRING:
    default: {
      // Handle objects that aren't explicitly JSON type (fallback for legacy data)
      if (typeof value === 'object' && !(value instanceof Date)) {
        try {
          const formatted = JSON.stringify(value);
          return maxLength ? truncateString(formatted, maxLength) : formatted;
        } catch {
          return '[Invalid Object]';
        }
      }

      // Convert to string and optionally truncate
      const stringValue = String(value);
      return maxLength ? truncateString(stringValue, maxLength) : stringValue;
    }
  }
}

/**
 * Helper function to truncate strings with ellipsis
 */
function truncateString(str: string, maxLength: number): string {
  if (str.length <= maxLength) {
    return str;
  }
  return str.substring(0, maxLength - 3) + '...';
}
