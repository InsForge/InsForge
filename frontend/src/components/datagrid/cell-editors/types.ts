import { ColumnType } from '@insforge/shared-schemas';

/**
 * Base props for all cell editors
 */
export interface BaseCellEditorProps {
  nullable: boolean;
  onCancel: () => void;
  className?: string;
}

/**
 * Boolean cell editor specific props
 */
export interface BooleanCellEditorProps extends BaseCellEditorProps {
  value: boolean | null;
  onValueChange: (newValue: string) => void; // Returns 'true', 'false', or 'null'
}

/**
 * Date cell editor specific props
 */
export interface DateCellEditorProps extends BaseCellEditorProps {
  value: string | null;
  type: ColumnType.DATE | ColumnType.DATETIME;
  onValueChange: (newValue: string | null) => void;
}

/**
 * JSON cell editor specific props
 */
export interface JsonCellEditorProps extends BaseCellEditorProps {
  value: string | null;
  onValueChange: (newValue: string) => void;
}

/**
 * Text cell editor specific props
 */
export interface TextCellEditorProps extends BaseCellEditorProps {
  value: string;
  onValueChange: (newValue: string) => void;
}
