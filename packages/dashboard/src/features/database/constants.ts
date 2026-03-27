import { Type, Clock, Calendar, Hash, Percent, ToggleLeft, Fingerprint, Code } from 'lucide-react';
import { ColumnType } from '@insforge/shared-schemas';

// Special handling for auth.users foreign key references
export const AUTH_USERS_TABLE = 'auth.users';

// schema for auth.users - used for displaying user records
export const authUsersSchema = {
  tableName: 'auth.users',
  columns: [
    { columnName: 'id', type: 'uuid', isUnique: true, isNullable: false },
    { columnName: 'email', type: 'string', isUnique: true, isNullable: false },
    { columnName: 'emailVerified', type: 'boolean', isUnique: false, isNullable: false },
    { columnName: 'providers', type: 'json', isUnique: false, isNullable: true },
    { columnName: 'createdAt', type: 'timestamp', isUnique: false, isNullable: false },
    { columnName: 'updatedAt', type: 'timestamp', isUnique: false, isNullable: false },
  ],
};

export const columnTypeIcons: Record<ColumnType, React.ComponentType<{ className?: string }>> = {
  [ColumnType.STRING]: Type,
  [ColumnType.DATE]: Calendar,
  [ColumnType.DATETIME]: Clock,
  [ColumnType.INTEGER]: Hash,
  [ColumnType.FLOAT]: Percent,
  [ColumnType.BOOLEAN]: ToggleLeft,
  [ColumnType.UUID]: Fingerprint,
  [ColumnType.JSON]: Code,
};

export const columnTypeDescriptions: Record<ColumnType, string> = {
  [ColumnType.STRING]: 'Text values of any length',
  [ColumnType.INTEGER]: 'Whole numbers without decimals',
  [ColumnType.FLOAT]: 'Numbers with decimal places',
  [ColumnType.BOOLEAN]: 'True or false values',
  [ColumnType.DATETIME]: 'Date and time values',
  [ColumnType.DATE]: 'Date values',
  [ColumnType.UUID]: 'Unique identifiers (auto-generated)',
  [ColumnType.JSON]: 'Complex structured data',
};
