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
