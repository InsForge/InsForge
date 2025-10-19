import { ColumnType } from '@insforge/shared-schemas';
import { type ClassValue, clsx } from 'clsx';
import { twMerge } from 'tailwind-merge';
import { z } from 'zod';
import { format, parse, isValid, parseISO } from 'date-fns';
import {
  uuidSchema,
  integerSchema,
  floatSchema,
  booleanSchema,
  dateSchema,
  dateTimeSchema,
  jsonSchema,
  stringSchema,
} from './validation-schemas';
import { v4 as uuidv4 } from 'uuid';
import type { ConvertedValue, DisplayValue, ValueConversionResult } from '@/components/datagrid';

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

/**
 * Convert and validate a string value based on the specified ColumnType
 */
export function convertValueForColumn(
  type: ColumnType | string,
  value: string | null | undefined
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
      case ColumnType.DATE:
        convertedValue = dateSchema.parse(value);
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
 * Generate a UUID v4 using the uuid library
 * Works in all browsers and contexts (secure and non-secure)
 * Uses crypto.getRandomValues when available, falls back to Math.random
 */
export function generateUUID(): string {
  return uuidv4();
}

/**
 * Centralized value formatter that handles all data types consistently
 * Converts database values to formatted display strings for UI components
 */
export function formatValueForDisplay(value: ConvertedValue, type?: ColumnType): DisplayValue {
  // Handle null/undefined values
  if (isEmptyValue(value)) {
    return 'null';
  }

  // Handle different column types
  switch (type) {
    case ColumnType.BOOLEAN:
      return value ? 'True' : 'False';

    case ColumnType.DATE: {
      const date = parse(String(value), 'yyyy-MM-dd', new Date());
      if (!isValid(date)) {
        return String(value);
      }
      const displayValue = format(date, 'MMM dd, yyyy');
      return displayValue;
    }

    case ColumnType.DATETIME: {
      const date = parseISO(String(value));
      if (!isValid(date)) {
        return String(value);
      }
      const displayValue = format(date, 'MMM dd, yyyy, hh:mm a');
      return displayValue;
    }

    case ColumnType.JSON: {
      try {
        const parsed = typeof value === 'string' ? JSON.parse(value) : value;
        const formatted =
          parsed && typeof parsed === 'object' ? JSON.stringify(parsed) : String(parsed);

        return formatted;
      } catch {
        return 'Invalid JSON';
      }
    }

    case ColumnType.INTEGER:
    case ColumnType.FLOAT: {
      return String(value);
    }

    case ColumnType.UUID:
    case ColumnType.STRING:
    default: {
      // Convert to string and optionally truncate
      return String(value);
    }
  }
}

/**
 * Check if a value is considered empty for database purposes
 */
export function isEmptyValue(value: unknown): boolean {
  return value === null || value === undefined || value === '';
}

export const isInsForgeCloudProject = () => {
  return window.location.hostname.endsWith('.insforge.app');
};

export const getBackendUrl = () => {
  const isHttp = window.location.protocol === 'http:';
  return isHttp ? 'http://localhost:7130' : window.location.origin;
};

export const isIframe = () => {
  return window.self !== window.top;
};
