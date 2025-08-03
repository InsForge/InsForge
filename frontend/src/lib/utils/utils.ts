import { ColumnType } from '@insforge/shared-schemas';
import { type ClassValue, clsx } from 'clsx';
import { twMerge } from 'tailwind-merge';

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export const validateEmail = (email: string) => {
  return /^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$/.test(email);
};

// Map database types to frontend FieldType
export const mapDatabaseTypeToFieldType = (dbType: string): ColumnType => {
  switch (dbType.toLocaleLowerCase()) {
    case 'uuid':
      return ColumnType.UUID;
    case 'timestamp with time zone':
      return ColumnType.DATETIME;
    case 'integer':
      return ColumnType.INTEGER;
    case 'double precision':
      return ColumnType.FLOAT;
    case 'boolean':
      return ColumnType.BOOLEAN;
    case 'jsonb':
      return ColumnType.JSON;
    case 'text':
    default:
      return ColumnType.STRING;
  }
};
