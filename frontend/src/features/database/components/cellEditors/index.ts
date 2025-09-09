import type { UserInputValue } from '@/components/datagrid';

export type CellEditorProps<T extends UserInputValue> = {
  value: T;
  nullable: boolean;
  onValueChange: (newValue: string) => void;
  onCancel: () => void;
  className?: string;
};

export { BooleanCellEditor } from './BooleanCellEditor';
export { DateCellEditor } from './DateCellEditor';
export { JsonCellEditor } from './JsonCellEditor';
