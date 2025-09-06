import type { UserInputValue } from '@/lib/types/datagridTypes';

export type CellEditorProps<T extends UserInputValue> = {
  value: T;
  nullable: boolean;
  onValueChange: (newValue: string) => void;
  onCancel: () => void;
};
