import React, { useState } from 'react';
import { Control, Controller, UseFormReturn } from 'react-hook-form';
import { Input } from '@/components/radix/Input';
import { Label } from '@/components/radix/Label';
import { Button } from '@/components/radix/Button';
import { Calendar } from 'lucide-react';
import { BooleanCellEditor, DateCellEditor, JsonCellEditor } from './cellEditors';
import { ColumnSchema, ColumnType } from '@insforge/shared-schemas';
import { convertValueForColumn, cn, formatValueForDisplay } from '@/lib/utils/utils';
import { TypeBadge } from '@/components/TypeBadge';
import { ForeignKeyField } from './ForeignKeyField';
import type { UserInputValue } from '@/lib/types/datagridTypes';

// Common styles for form inputs
const FORM_INPUT_CLASSES =
  'dark:text-white dark:placeholder:text-neutral-400 dark:bg-neutral-900 dark:border-neutral-700';

// Common interface for all form editors
interface BaseFormEditorProps {
  nullable: boolean;
  onChange: (value: UserInputValue) => void;
  hasForeignKey?: boolean;
}

// Helper function to get appropriate placeholder text
function getPlaceholderText(field: ColumnSchema): string {
  // Check if default value is a function
  if (field.defaultValue && field.defaultValue.endsWith('()')) {
    return 'Auto-generated on submit';
  }
  // Static default value or no default value
  return field.isNullable ? 'Optional' : 'Required';
}

// Form adapters for edit cell components
interface FormBooleanEditorProps extends BaseFormEditorProps {
  value: ColumnType.BOOLEAN | null;
}

function FormBooleanEditor({ value, nullable, onChange, hasForeignKey }: FormBooleanEditorProps) {
  const [showEditor, setShowEditor] = useState(false);

  const handleValueChange = (newValue: string) => {
    if (newValue === 'null') {
      onChange(null);
    } else {
      onChange(newValue === 'true');
    }
    setShowEditor(false);
  };

  const handleCancel = () => {
    setShowEditor(false);
  };

  if (showEditor) {
    return (
      <BooleanCellEditor
        value={value}
        nullable={nullable}
        onValueChange={handleValueChange}
        onCancel={handleCancel}
      />
    );
  }

  return (
    <Button
      type="button"
      variant="outline"
      onClick={() => setShowEditor(true)}
      className={cn('w-full justify-start h-9', FORM_INPUT_CLASSES, hasForeignKey && 'pr-16')}
    >
      {value === null ? 'null' : value ? 'true' : 'false'}
    </Button>
  );
}

interface FormDateEditorProps extends BaseFormEditorProps {
  value: string | null;
  type?: ColumnType.DATETIME;
  field: ColumnSchema;
}

function FormDateEditor({
  value,
  type = ColumnType.DATETIME,
  onChange,
  field,
}: FormDateEditorProps) {
  const [showEditor, setShowEditor] = useState(false);

  const handleValueChange = (newValue: string | null) => {
    if (newValue === 'null' || newValue === null) {
      onChange(null);
    } else {
      onChange(newValue);
    }
    setShowEditor(false);
  };

  const handleCancel = () => {
    setShowEditor(false);
  };

  if (showEditor) {
    return (
      <DateCellEditor
        value={value}
        type={type}
        nullable={field.isNullable}
        onValueChange={handleValueChange}
        onCancel={handleCancel}
      />
    );
  }

  const formatDisplayValue = () => {
    if (!value || value === 'null') {
      return getPlaceholderText(field);
    }

    // Use appropriate format based on type
    const dateFormat = type === ColumnType.DATETIME ? 'MMM dd, yyyy h:mm a' : 'MMM dd, yyyy';
    return formatValueForDisplay(value, ColumnType.DATETIME, { dateFormat });
  };

  return (
    <Button
      type="button"
      variant="outline"
      onClick={() => setShowEditor(true)}
      className={cn(
        'w-full justify-start h-9 text-black',
        FORM_INPUT_CLASSES,
        (!value || value === 'null') && 'text-muted-foreground dark:text-neutral-400',
        !!field.foreignKey && 'pr-16'
      )}
    >
      <Calendar className="mr-2 h-4 w-4" />
      {formatDisplayValue()}
    </Button>
  );
}

interface FormNumberEditorProps extends BaseFormEditorProps {
  value: number | null;
  type: ColumnType.INTEGER | ColumnType.FLOAT;
  tableName: string;
  field: ColumnSchema;
}

function FormNumberEditor({ value, type, onChange, tableName, field }: FormNumberEditorProps) {
  return (
    <Input
      id={`${tableName}-${field.columnName}`}
      type={type === ColumnType.INTEGER ? 'number' : 'text'}
      step={type === ColumnType.INTEGER ? '1' : undefined}
      value={value ?? ''}
      onChange={(e) => {
        const inputValue = e.target.value;
        if (inputValue === '') {
          // Handle empty value - let form validation handle required fields
          onChange(null);
        } else {
          const numValue = type === ColumnType.INTEGER ? parseInt(inputValue, 10) : parseFloat(inputValue);
          onChange(isNaN(numValue) ? null : numValue);
        }
      }}
      placeholder={getPlaceholderText(field)}
      className={cn(FORM_INPUT_CLASSES, !!field.foreignKey && 'pr-16')}
    />
  );
}

interface FormJsonEditorProps extends BaseFormEditorProps {
  value: string | null;
}

function FormJsonEditor({ value, nullable, onChange, hasForeignKey }: FormJsonEditorProps) {
  const [showEditor, setShowEditor] = useState(false);

  const handleValueChange = (newValue: string) => {
    onChange(newValue);
    setShowEditor(false);
  };

  const handleCancel = () => {
    setShowEditor(false);
  };

  if (showEditor) {
    return (
      <JsonCellEditor
        value={value}
        nullable={nullable}
        onValueChange={handleValueChange}
        onCancel={handleCancel}
      />
    );
  }

  const formatDisplayValue = () => {
    if (!value || value === 'null') {
      return 'Empty JSON';
    }
    return formatValueForDisplay(value, ColumnType.JSON);
  };

  return (
    <Button
      type="button"
      variant="outline"
      onClick={() => setShowEditor(true)}
      className={cn(
        'w-full justify-start h-9 text-black',
        FORM_INPUT_CLASSES,
        (!value || value === 'null') && 'text-muted-foreground dark:text-neutral-400',
        hasForeignKey && 'pr-16'
      )}
    >
      {formatDisplayValue()}
    </Button>
  );
}

interface FormFieldProps {
  field: ColumnSchema;
  form: UseFormReturn<any>;
  tableName: string;
}

// Helper component to render field label with type badge
function FieldLabel({
  field,
  tableName,
  children,
}: {
  field: ColumnSchema;
  tableName: string;
  children?: React.ReactNode;
}) {
  return (
    <Label htmlFor={`${tableName}-${field.columnName}`} className="flex items-center gap-2">
      <TypeBadge type={field.type} className="h-6 dark:bg-neutral-900 dark:border-neutral-700" />
      <span className="text-sm text-black dark:text-white truncate block" title={field.columnName}>
        {field.columnName}
      </span>
      {!field.isNullable && <span className="text-red-500 dark:text-red-400">*</span>}
      {children}
    </Label>
  );
}

// Generic field layout component to eliminate repetitive grid layout
interface FieldLayoutProps {
  field: ColumnSchema;
  tableName: string;
  children: React.ReactNode;
}

function FieldLayout({ field, tableName, children }: FieldLayoutProps) {
  return (
    <div className="grid grid-cols-8 gap-x-10">
      <div className="col-span-3">
        <FieldLabel field={field} tableName={tableName} />
      </div>
      <div className="col-span-5">{children}</div>
    </div>
  );
}

// ForeignKeyField is now imported from its own file

// Field renderer mapping for cleaner code organization
const fieldRenderers = {
  [ColumnType.BOOLEAN]: (
    field: ColumnSchema,
    control: Control<any>,
    _tableName: string,
    _register: any,
    hasForeignKey: boolean
  ) => (
    <Controller
      control={control}
      name={field.columnName}
      render={({ field: formField }) => (
        <FormBooleanEditor
          value={formField.value}
          nullable={field.isNullable}
          onChange={formField.onChange}
          hasForeignKey={hasForeignKey}
        />
      )}
    />
  ),

  [ColumnType.INTEGER]: (
    field: ColumnSchema,
    control: Control<any>,
    tableName: string,
    _register: any,
    hasForeignKey: boolean
  ) => (
    <Controller
      control={control}
      name={field.columnName}
      render={({ field: formField }) => (
        <FormNumberEditor
          value={formField.value}
          type={ColumnType.INTEGER}
          nullable={field.isNullable}
          onChange={formField.onChange}
          tableName={tableName}
          hasForeignKey={hasForeignKey}
          field={field}
        />
      )}
    />
  ),

  [ColumnType.FLOAT]: (
    field: ColumnSchema,
    control: Control<any>,
    tableName: string,
    _register: any,
    hasForeignKey: boolean
  ) => (
    <Controller
      control={control}
      name={field.columnName}
      render={({ field: formField }) => (
        <FormNumberEditor
          value={formField.value}
          type={ColumnType.FLOAT}
          nullable={field.isNullable}
          onChange={formField.onChange}
          tableName={tableName}
          hasForeignKey={hasForeignKey}
          field={field}
        />
      )}
    />
  ),

  [ColumnType.DATETIME]: (
    field: ColumnSchema,
    control: Control<any>,
    _tableName: string,
    _register: any,
    hasForeignKey: boolean
  ) => (
    <Controller
      control={control}
      name={field.columnName}
      render={({ field: formField }) => (
        <FormDateEditor
          value={formField.value}
          type={ColumnType.DATETIME}
          nullable={field.isNullable}
          onChange={formField.onChange}
          hasForeignKey={hasForeignKey}
          field={field}
        />
      )}
    />
  ),

  [ColumnType.JSON]: (
    field: ColumnSchema,
    control: Control<any>,
    _tableName: string,
    _register: any,
    hasForeignKey: boolean
  ) => (
    <Controller
      control={control}
      name={field.columnName}
      render={({ field: formField }) => (
        <FormJsonEditor
          value={
            typeof formField.value === 'object' ? JSON.stringify(formField.value) : formField.value
          }
          nullable={field.isNullable}
          onChange={(newValue) => {
            const result = convertValueForColumn(ColumnType.JSON, newValue);
            if (result.success) {
              formField.onChange(result.value as JSON);
            } else {
              // If parsing fails, keep the string value
              formField.onChange(newValue);
            }
          }}
          hasForeignKey={hasForeignKey}
        />
      )}
    />
  ),

  [ColumnType.UUID]: (
    field: ColumnSchema,
    control: Control<any>,
    tableName: string,
    _register: any,
    hasForeignKey: boolean
  ) => (
    <Controller
      control={control}
      name={field.columnName}
      render={({ field: formField }) => (
        <Input
          id={`${tableName}-${field.columnName}`}
          type="text"
          value={formField.value || ''}
          onChange={(e) => formField.onChange(e.target.value)}
          placeholder={getPlaceholderText(field)}
          className={cn(FORM_INPUT_CLASSES, hasForeignKey && 'pr-16')}
        />
      )}
    />
  ),

  [ColumnType.STRING]: (
    field: ColumnSchema,
    control: Control<any>,
    tableName: string,
    _register: any,
    hasForeignKey: boolean
  ) => (
    <Controller
      control={control}
      name={field.columnName}
      render={({ field: formField }) => (
        <Input
          id={`${tableName}-${field.columnName}`}
          type={field.columnName === 'password' ? 'password' : 'text'}
          value={formField.value || ''}
          onChange={(e) => formField.onChange(e.target.value)}
          placeholder={field.isNullable ? 'Optional' : 'Required'}
          className={cn(FORM_INPUT_CLASSES, hasForeignKey && 'pr-16')}
        />
      )}
    />
  ),
};

export function FormField({ field, form, tableName }: FormFieldProps) {
  const {
    control,
    register,
    formState: { errors },
  } = form;

  const renderFieldEditor = () => {
    const renderer = fieldRenderers[field.type] || fieldRenderers[ColumnType.STRING];
    const hasForeignKey = !!field.foreignKey;
    return renderer(field, control, tableName, register, hasForeignKey);
  };

  const renderField = () => {
    const fieldEditor = renderFieldEditor();

    // Check if field has foreign key and wrap accordingly
    if (field.foreignKey) {
      return (
        <FieldLayout field={field} tableName={tableName}>
          <ForeignKeyField field={field} control={control}>
            {fieldEditor}
          </ForeignKeyField>
        </FieldLayout>
      );
    }

    // Regular field without foreign key
    return (
      <FieldLayout field={field} tableName={tableName}>
        {fieldEditor}
      </FieldLayout>
    );
  };

  return (
    <div className="space-y-2">
      {renderField()}
      {errors[field.columnName] && (
        <p className="text-sm text-red-500 dark:text-red-400">
          {(errors[field.columnName] as any)?.message || `${field.columnName} is required`}
        </p>
      )}
    </div>
  );
}
