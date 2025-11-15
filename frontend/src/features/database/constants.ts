import { Type, Clock, Calendar, Hash, Percent, ToggleLeft, Fingerprint, Code } from 'lucide-react';
import { ColumnType } from '@insforge/shared-schemas';

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

/**
 * System tables that should be filtered out from user-facing database views
 */
export const SYSTEM_TABLES = ['users'];
export const SYSTEM_FUNCTIONS = [
  'create_default_policies',
  'create_policies_after_rls',
  'email',
  'reload_postgrest_schema',
  'role',
  'uid',
  'update_updated_at_column',
  'build_http_headers',
  'decrypt_headers',
  'delete_cron_schedule',
  'disable_cron_schedule',
  'enable_cron_schedule',
  'encrypt_headers',
  'execute_scheduled_request',
  'log_schedule_execution',
  'upsert_cron_schedule',
];

/**
 * Check if a table name is a system table
 */
export function isSystemTable(tableName: string): boolean {
  return tableName.startsWith('_') || SYSTEM_TABLES.includes(tableName);
}

/**
 * Check if a function name is a system function
 */
export function isSystemFunction(functionName: string): boolean {
  return SYSTEM_FUNCTIONS.includes(functionName);
}
