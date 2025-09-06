import React, { useState } from 'react';
import { Control, Controller, UseFormReturn } from 'react-hook-form';
import { Input } from '@/components/radix/Input';
import { Label } from '@/components/radix/Label';
import { Button } from '@/components/radix/Button';
import { Calendar, Link2, X } from 'lucide-react';
import { BooleanCellEditor } from './BooleanCellEditor';
import { DateCellEditor } from './DateCellEditor';
import { JsonCellEditor } from './JsonCellEditor';
import { LinkRecordModal } from './LinkRecordModal';
import { ColumnSchema, ColumnType } from '@insforge/shared-schemas';
import { convertValueForColumn, cn, formatValueForDisplay } from '@/lib/utils/utils';
import { TypeBadge } from '@/components/TypeBadge';

// Type for database records
type DatabaseRecord = Record<string, any>;

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
interface FormBooleanEditorProps {
  value: boolean | null;
  nullable: boolean;
  onChange: (value: boolean | null) => void;
  hasForeignKey?: boolean;
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
      className={`w-full justify-start h-9 dark:text-white dark:bg-neutral-900 dark:placeholder:text-neutral-400 dark:border-neutral-700 ${hasForeignKey ? 'pr-20' : ''}`}
    >
      {value === null ? 'null' : value ? 'true' : 'false'}
    </Button>
  );
}

interface FormDateEditorProps {
  value: string | null;
  type?: ColumnType.DATETIME;
  onChange: (value: string | null) => void;
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

    return formatValueForDisplay(value, type);
  };

  return (
    <Button
      type="button"
      variant="outline"
      onClick={() => setShowEditor(true)}
      className={cn(
        'w-full justify-start h-9 text-black dark:text-white dark:bg-neutral-900 dark:border-neutral-700',
        (!value || value === 'null') && 'text-muted-foreground dark:text-neutral-400',
        !!field.foreignKey && 'pr-20'
      )}
    >
      <Calendar className="mr-2 h-4 w-4" />
      {formatDisplayValue()}
    </Button>
  );
}

interface FormNumberEditorProps {
  value: number | null;
  type: ColumnType.INTEGER | ColumnType.FLOAT;
  onChange: (value: number | null) => void;
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
      className={`dark:text-white dark:placeholder:text-neutral-400 dark:bg-neutral-900 dark:border-neutral-700 ${field.foreignKey ? 'pr-16' : ''}`}
    />
  );
}

interface FormJsonEditorProps {
  value: string | null;
  onChange: (value: string | null) => void;
  nullable: boolean;
  hasForeignKey: boolean;
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

    try {
      // Ensure we're working with an object, not a string
      const parsed = typeof value === 'string' ? JSON.parse(value) : value;

      if (!parsed || typeof parsed !== 'object') {
        return String(parsed);
      }

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
      className={cn(
        'w-full justify-start h-9 text-black dark:text-white dark:bg-neutral-900 dark:border-neutral-700',
        (!value || value === 'null') && 'text-muted-foreground dark:text-neutral-400',
        hasForeignKey && 'pr-20'
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

// Generic component for any field type with foreign key linking
interface FieldWithLinkProps {
  field: ColumnSchema;
  control: Control<any, any, any>;
  children: React.ReactNode;
}

function FieldWithLink({ field, control, children }: FieldWithLinkProps) {
  const [showLinkModal, setShowLinkModal] = useState(false);

  if (!field.foreignKey) {
    // Regular field without foreign key
    return <>{children}</>;
  }

  // Field with foreign key linking capability - integrated design
  return (
    <>
      <Controller
        control={control}
        name={field.columnName}
        render={({ field: formField }) => {
          const hasLinkedValue = formField.value && formField.value !== '';
          const childElement = children as React.ReactElement<any>;
          const existingClassName = childElement.props.className || '';
          const paddingClass = hasLinkedValue ? 'pr-16' : 'pr-11';
          const modifiedChildren = React.cloneElement(childElement, {
            value: formField.value,
            className: `${existingClassName} ${paddingClass}`.trim(),
          });

          return (
            <>
              <div className="space-y-1">
                <div className="relative">
                  {modifiedChildren}
                  <div className="absolute right-0 top-1/2 -translate-y-1/2 flex items-center">
                    {hasLinkedValue && (
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        onClick={() => formField.onChange('')}
                        className="h-7 w-7 p-1 flex-shrink-0 text-zinc-500 hover:text-red-600 hover:bg-red-50 dark:text-neutral-400 dark:hover:text-red-400 dark:hover:bg-red-950/20"
                        title="Clear linked record"
                      >
                        <X className="h-4 w-4" />
                      </Button>
                    )}
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      onClick={() => setShowLinkModal(true)}
                      className="rounded-l-none h-9 w-9 p-2 flex-shrink-0 text-zinc-500 hover:text-zinc-700 hover:bg-zinc-100 dark:text-neutral-400 dark:hover:text-neutral-200 dark:hover:bg-neutral-700 border-l border-zinc-200 dark:border-neutral-700"
                      title={
                        hasLinkedValue
                          ? `Change linked ${field.foreignKey?.referenceTable} record`
                          : `Link to ${field.foreignKey?.referenceTable} record`
                      }
                    >
                      <Link2 className="h-5 w-5" />
                    </Button>
                  </div>
                </div>

                {/* Foreign Key Relationship Info */}
                <div className="text-xs text-medium text-black dark:text-neutral-400 flex items-center gap-1.5">
                  <span>Has a Foreign Key relation to</span>
                  <TypeBadge
                    type={`${field.foreignKey?.referenceTable}.${field.foreignKey?.referenceColumn}`}
                    className="dark:bg-neutral-700"
                  />
                </div>
              </div>

              <LinkRecordModal
                open={showLinkModal}
                onOpenChange={setShowLinkModal}
                referenceTable={field.foreignKey!.referenceTable}
                referenceColumn={field.foreignKey!.referenceColumn}
                currentValue={formField.value}
                onSelectRecord={(record: DatabaseRecord) => {
                  const referenceValue = record[field.foreignKey!.referenceColumn];
                  formField.onChange(referenceValue);
                }}
              />
            </>
          );
        }}
      />
    </>
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

    switch (field.type) {
      case ColumnType.BOOLEAN:
        return (
          <div className="grid grid-cols-6 gap-x-10">
            <div className="col-span-2">
              <FieldLabel field={field} tableName={tableName} />
            </div>
            <div className="col-span-4">
              <FieldWithLink field={field} control={control}>
                <Controller
                  control={control}
                  name={field.columnName}
                  render={({ field: formField }) => (
                    <FormBooleanEditor
                      value={formField.value}
                      nullable={field.isNullable}
                      onChange={formField.onChange}
                      hasForeignKey={!!field.foreignKey}
                    />
                  )}
                />
              </FieldWithLink>
            </div>
          </div>
        );

      case ColumnType.INTEGER:
      case ColumnType.FLOAT:
        return (
          <div className="grid grid-cols-6 gap-x-10">
            <div className="col-span-2">
              <FieldLabel field={field} tableName={tableName} />
            </div>
            <div className="col-span-4">
              <FieldWithLink field={field} control={control}>
                <Controller
                  control={control}
                  name={field.columnName}
                  render={({ field: formField }) => (
                    <FormNumberEditor
                      value={formField.value}
                      type={field.type === ColumnType.INTEGER ? ColumnType.INTEGER : ColumnType.FLOAT}
                      onChange={formField.onChange}
                      tableName={tableName}
                      field={field}
                    />
                  )}
                />
              </FieldWithLink>
            </div>
          </div>
        );

      case ColumnType.DATETIME:
        return (
          <div className="grid grid-cols-6 gap-x-10">
            <div className="col-span-2">
              <FieldLabel field={field} tableName={tableName} />
            </div>
            <div className="col-span-4">
              <FieldWithLink field={field} control={control}>
                <Controller
                  control={control}
                  name={field.columnName}
                  render={({ field: formField }) => (
                    <FormDateEditor
                      value={formField.value}
                      type={ColumnType.DATETIME}
                      onChange={formField.onChange}
                      field={field}
                    />
                  )}
                />
              </FieldWithLink>
            </div>
          </div>
        );

      case ColumnType.JSON:
        return (
          <div className="grid grid-cols-6 gap-x-10">
            <div className="col-span-2">
              <FieldLabel field={field} tableName={tableName} />
            </div>
            <div className="col-span-4">
              <FieldWithLink field={field} control={control}>
                <Controller
                  control={control}
                  name={field.columnName}
                  render={({ field: formField }) => {
                    return (
                      <FormJsonEditor
                        value={
                          typeof formField.value === 'object'
                            ? JSON.stringify(formField.value)
                            : formField.value
                        }
                        nullable={field.isNullable}
                        hasForeignKey={!!field.foreignKey}
                        onChange={(newValue) => {
                          const result = convertValueForColumn(ColumnType.JSON, newValue);
                          if (result.success) {
                            formField.onChange(result.value as JSON);
                          } else {
                            // If parsing fails, keep the string value
                            formField.onChange(newValue);
                          }
                        }}
                      />
                    );
                  }}
                />
              </FieldWithLink>
            </div>
          </div>
        );

      case ColumnType.UUID:
        return (
          <div className="grid grid-cols-6 gap-x-10">
            <div className="col-span-2">
              <FieldLabel field={field} tableName={tableName} />
            </div>
            <div className="col-span-4">
              <FieldWithLink field={field} control={control}>
                <Input
                  id={`${tableName}-${field.columnName}`}
                  type="text"
                  {...register(field.columnName)}
                  placeholder={getPlaceholderText(field)}
                  className="dark:text-white dark:placeholder:text-neutral-400 dark:bg-neutral-900 dark:border-neutral-700"
                />
              </FieldWithLink>
            </div>
          </div>
        );

      case ColumnType.STRING:
      default:
        return (
          <div className="grid grid-cols-6 gap-x-10">
            <div className="col-span-2">
              <FieldLabel field={field} tableName={tableName} />
            </div>
            <div className="col-span-4">
              <FieldWithLink field={field} control={control}>
                <Input
                  id={`${tableName}-${field.columnName}`}
                  type={field.columnName === 'password' ? 'password' : 'text'}
                  {...register(field.columnName)}
                  placeholder={getPlaceholderText(field)}
                  className="dark:text-white dark:placeholder:text-neutral-400 dark:bg-neutral-900 dark:border-neutral-700"
                />
              </FieldWithLink>
            </div>
          </div>
        );
    }
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
