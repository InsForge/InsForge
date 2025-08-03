import React, { useState } from 'react';
import { Controller, UseFormReturn } from 'react-hook-form';
import { Input } from '@/components/radix/Input';
import { Label } from '@/components/radix/Label';
import { TypeBadge } from '@/features/database/components/TypeBadge';
import { Button } from '@/components/radix/Button';
import { Calendar } from 'lucide-react';
import { BooleanCellEditor } from './BooleanCellEditor';
import { DateCellEditor } from './DateCellEditor';
import { JsonCellEditor } from './JsonCellEditor';
import { ColumnSchema, ColumnType } from '@insforge/shared-schemas';
import { mapDatabaseTypeToFieldType } from '@/lib/utils/utils';

// Form adapters for edit cell components
interface FormBooleanEditorProps {
  value: boolean | null;
  nullable: boolean;
  onChange: (value: boolean | null) => void;
}

function FormBooleanEditor({ value, nullable, onChange }: FormBooleanEditorProps) {
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
      className="w-full justify-start h-10"
    >
      {value === null ? 'null' : value ? 'true' : 'false'}
    </Button>
  );
}

interface FormDateEditorProps {
  value: string | null;
  type?: 'date' | 'datetime';
  nullable: boolean;
  onChange: (value: string | null) => void;
}

function FormDateEditor({ value, type = 'datetime', nullable, onChange }: FormDateEditorProps) {
  const [showEditor, setShowEditor] = useState(false);

  const handleValueChange = (newValue: string) => {
    if (newValue === 'null') {
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
        nullable={nullable}
        onValueChange={handleValueChange}
        onCancel={handleCancel}
      />
    );
  }

  const formatDisplayValue = () => {
    if (!value || value === 'null') {
      return 'Select date...';
    }

    const d = new Date(value);
    if (type === 'datetime') {
      return d.toLocaleString();
    }
    return d.toLocaleDateString();
  };

  return (
    <Button
      type="button"
      variant="outline"
      onClick={() => setShowEditor(true)}
      className="w-full justify-start h-10"
    >
      <Calendar className="mr-2 h-4 w-4" />
      {formatDisplayValue()}
    </Button>
  );
}

interface FormJsonEditorProps {
  value: string | null;
  nullable: boolean;
  onChange: (value: string | null) => void;
}

function FormJsonEditor({ value, nullable, onChange }: FormJsonEditorProps) {
  const [showEditor, setShowEditor] = useState(false);

  const handleValueChange = (newValue: string) => {
    if (newValue === 'null') {
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

    try {
      const parsed = JSON.parse(value);
      const keys = Object.keys(parsed);
      if (keys.length === 0) {
        return '{}';
      }
      if (keys.length === 1) {
        return `{ ${keys[0]}: ... }`;
      }
      return `{ ${keys.length} properties }`;
    } catch {
      return 'Invalid JSON';
    }
  };

  return (
    <Button
      type="button"
      variant="outline"
      onClick={() => setShowEditor(true)}
      className="w-full justify-start h-10"
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
    <Label htmlFor={`${tableName}-${field.name}`} className="flex items-center gap-2.5 mb-3">
      <span>
        {field.name}
        {!field.nullable && field.name !== 'id' && <span className="text-red-500 ml-1">*</span>}
      </span>
      <TypeBadge type={field.type} />
      {children}
    </Label>
  );
}

export function FormField({ field, form, tableName }: FormFieldProps) {
  const {
    control,
    register,
    formState: { errors },
  } = form;

  // TODO: This is a mess, we need to clean it up. To fix in future.
  const renderField = () => {
    // Infer frontend type from field name and SQLite type
    const fieldType = mapDatabaseTypeToFieldType(field.type);

    switch (fieldType) {
      case ColumnType.BOOLEAN:
        return (
          <>
            <FieldLabel field={field} tableName={tableName} />
            <Controller
              control={control}
              name={field.name}
              render={({ field: formField }) => (
                <FormBooleanEditor
                  value={formField.value}
                  nullable={field.nullable}
                  onChange={formField.onChange}
                />
              )}
            />
          </>
        );

      case ColumnType.INTEGER:
      case ColumnType.FLOAT:
        return (
          <>
            <FieldLabel field={field} tableName={tableName} />
            <Controller
              control={control}
              name={field.name}
              render={({ field: formField }) => (
                <Input
                  id={`${tableName}-${field.name}`}
                  type="number"
                  step={fieldType === ColumnType.FLOAT ? '0.01' : '1'}
                  value={formField.value ?? ''}
                  onChange={(e) => {
                    const value = e.target.value;
                    if (value === '') {
                      // Handle empty value based on nullability
                      formField.onChange(field.nullable ? null : 0);
                    } else {
                      const numValue =
                        fieldType === ColumnType.INTEGER ? parseInt(value, 10) : parseFloat(value);
                      formField.onChange(isNaN(numValue) ? (field.nullable ? null : 0) : numValue);
                    }
                  }}
                  placeholder={field.nullable ? 'Optional' : 'Required'}
                />
              )}
            />
          </>
        );

      case ColumnType.DATETIME:
        return (
          <>
            <FieldLabel field={field} tableName={tableName} />
            <Controller
              control={control}
              name={field.name}
              render={({ field: formField }) => (
                <FormDateEditor
                  value={formField.value}
                  type="datetime"
                  nullable={field.nullable}
                  onChange={formField.onChange}
                />
              )}
            />
          </>
        );

      case ColumnType.JSON:
        return (
          <>
            <FieldLabel field={field} tableName={tableName} />
            <Controller
              control={control}
              name={field.name}
              render={({ field: formField }) => (
                <FormJsonEditor
                  value={formField.value}
                  nullable={field.nullable}
                  onChange={formField.onChange}
                />
              )}
            />
          </>
        );

      case ColumnType.UUID:
        return (
          <>
            <FieldLabel field={field} tableName={tableName} />
            <Input
              id={`${tableName}-${field.name}`}
              type="text"
              {...register(field.name)}
              placeholder="Auto-generated if empty"
            />
          </>
        );

      case ColumnType.STRING:
      default:
        return (
          <>
            <FieldLabel field={field} tableName={tableName} />
            <Input
              id={`${tableName}-${field.name}`}
              type={field.name === 'password' ? 'password' : 'text'}
              {...register(field.name)}
              placeholder={field.nullable ? 'Optional' : 'Required'}
            />
          </>
        );
    }
  };

  return (
    <div className="space-y-2">
      {renderField()}
      {errors[field.name] && (
        <p className="text-sm text-red-500">
          {(errors[field.name] as any)?.message || `${field.name} is required`}
        </p>
      )}
    </div>
  );
}
