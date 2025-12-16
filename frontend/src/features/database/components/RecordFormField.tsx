import React, { useState } from 'react';
import { Control, Controller, FieldError, UseFormReturn } from 'react-hook-form';
import { Calendar, Clock, Link2, X } from 'lucide-react';
import {
  Button,
  Label,
  Input,
  BooleanCellEditor,
  DateCellEditor,
  JsonCellEditor,
  type DatabaseRecord,
  type ConvertedValue,
  type UserInputValue,
  TypeBadge,
} from '@/components';
import { ColumnSchema, ColumnType } from '@insforge/shared-schemas';
import { convertValueForColumn, cn, formatValueForDisplay } from '@/lib/utils/utils';
import { LinkRecordModal } from '@/features/database/components/LinkRecordModal';
import { isValid, parseISO } from 'date-fns';

// Helper function to get appropriate placeholder text
function getPlaceholderText(field: ColumnSchema): string {
  // Check if default value is a function
  if (field.defaultValue && field.defaultValue.endsWith('()')) {
    return 'Auto-generated on submit';
  }
  // Static default value or no default value
  return field.isNullable ? 'Optional' : 'Required';
}

// Common interface for all form editors
interface BaseFormEditorProps {
  nullable: boolean;
  onChange: (value: ConvertedValue) => void;
  hasForeignKey?: boolean;
}

// Form adapters for edit cell components
interface FormBooleanEditorProps extends BaseFormEditorProps {
  value: boolean | null;
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
        className="h-9 px-4 py-2 dark:bg-neutral-900 border"
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
      {formatValueForDisplay(value, ColumnType.BOOLEAN)}
    </Button>
  );
}

interface FormDateEditorProps extends BaseFormEditorProps {
  value: string | null;
  type?: ColumnType.DATETIME | ColumnType.DATE;
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

  const formatDisplayValue = () => {
    if (!value || value === 'null') {
      return getPlaceholderText(field);
    }

    return formatValueForDisplay(value, type);
  };

  const formatValue = () => {
    if (!value || value === 'null') {
      return null;
    }

    const date = parseISO(value);
    return isValid(date) ? value : null;
  };

  if (showEditor) {
    return (
      <DateCellEditor
        value={formatValue()}
        type={type}
        nullable={field.isNullable}
        onValueChange={handleValueChange}
        onCancel={handleCancel}
        className="h-9 px-4 py-2 dark:bg-neutral-900 border dark:border-neutral-700"
      />
    );
  }

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
      {type === ColumnType.DATETIME ? (
        <Clock className="mr-2 h-4 w-4" />
      ) : (
        <Calendar className="mr-2 h-4 w-4" />
      )}
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
      type="number"
      step={type === ColumnType.INTEGER ? '1' : undefined}
      value={value ?? ''}
      onChange={(e) => {
        const inputValue = e.target.value;
        if (inputValue === '') {
          // Handle empty value - let form validation handle required fields
          onChange(null);
        } else {
          const numValue =
            type === ColumnType.INTEGER ? parseInt(inputValue, 10) : parseFloat(inputValue);
          onChange(isNaN(numValue) ? null : numValue);
        }
      }}
      placeholder={getPlaceholderText(field)}
      className={`dark:text-white dark:placeholder:text-neutral-400 dark:bg-neutral-900 dark:border-neutral-700 ${field.foreignKey ? 'pr-18' : ''}`}
    />
  );
}

interface FormJsonEditorProps extends BaseFormEditorProps {
  value: string | null;
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
        className="h-9 px-4 py-2 dark:bg-neutral-900 border dark:border-neutral-700"
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
        'w-full justify-start h-9 text-black dark:text-white dark:bg-neutral-900 dark:border-neutral-700',
        (!value || value === 'null') && 'text-muted-foreground dark:text-neutral-400',
        hasForeignKey && 'pr-20'
      )}
    >
      {formatDisplayValue()}
    </Button>
  );
}

interface RecordFormFieldProps {
  field: ColumnSchema;
  form: UseFormReturn<DatabaseRecord>;
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
  control: Control<DatabaseRecord>;
  children: React.ReactNode;
}

function FieldWithLink({ field, control, children }: FieldWithLinkProps) {
  if (!field.foreignKey) {
    // Regular field without foreign key
    return <>{children}</>;
  }

  // Store foreignKey in a const to help TypeScript narrow the type
  const foreignKey = field.foreignKey;

  // Field with foreign key linking capability - integrated design
  return (
    <>
      <Controller
        control={control}
        name={field.columnName}
        render={({ field: formField }) => {
          const hasLinkedValue = formField.value && formField.value !== '';
          const childElement = children as React.ReactElement<{
            className?: string;
            value?: UserInputValue;
          }>;
          const existingClassName = childElement.props.className || '';
          const paddingClass = hasLinkedValue ? 'pr-16' : 'pr-11';
          const modifiedChildren = React.cloneElement(childElement, {
            value: formField.value as UserInputValue,
            className: `${existingClassName} ${paddingClass}`.trim(),
          });

          return (
            <>
              <div className="space-y-1">
                <div className="relative">
                  {modifiedChildren}
                  <div className="absolute right-0 top-1/2 -translate-y-1/2 flex items-center gap-1">
                    {(hasLinkedValue || hasLinkedValue === 0) && (
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        onClick={() => formField.onChange('')}
                        className="h-7 w-7 p-1 flex-shrink-0 text-zinc-500 hover:text-zinc-700 hover:bg-zinc-100 dark:text-neutral-400 dark:hover:text-neutral-200 dark:hover:bg-neutral-700"
                        title="Clear linked record"
                      >
                        <X className="h-4 w-4" />
                      </Button>
                    )}
                    <LinkRecordModal
                      referenceTable={foreignKey.referenceTable}
                      referenceColumn={foreignKey.referenceColumn}
                      onSelectRecord={(record: DatabaseRecord) => {
                        const referenceValue = record[foreignKey.referenceColumn];
                        const result = convertValueForColumn(
                          field.type,
                          String(referenceValue || '')
                        );
                        if (result.success) {
                          formField.onChange(result.value);
                        } else {
                          // Fallback to string if conversion fails
                          formField.onChange(String(referenceValue || ''));
                        }
                      }}
                    >
                      {(openModal) => (
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon"
                          onClick={openModal}
                          className="rounded-l-none h-9 w-9 p-2 flex-shrink-0 text-zinc-500 hover:text-zinc-700 hover:bg-zinc-100 dark:text-neutral-400 dark:hover:text-neutral-200 dark:hover:bg-neutral-700 border-l border-zinc-200 dark:border-neutral-700"
                          title={
                            hasLinkedValue
                              ? `Change linked ${foreignKey.referenceTable} record`
                              : `Link to ${foreignKey.referenceTable} record`
                          }
                        >
                          <Link2 className="h-5 w-5" />
                        </Button>
                      )}
                    </LinkRecordModal>
                  </div>
                </div>

                {/* Foreign Key Relationship Info */}
                <div className="text-xs text-medium text-black dark:text-neutral-400 flex items-center gap-1.5">
                  <span>Has a Foreign Key relation to</span>
                  <TypeBadge
                    type={`${foreignKey.referenceTable}.${foreignKey.referenceColumn}`}
                    className="dark:bg-neutral-700"
                  />
                </div>
              </div>
            </>
          );
        }}
      />
    </>
  );
}

export function RecordFormField({ field, form, tableName }: RecordFormFieldProps) {
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
                      value={formField.value as boolean | null}
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
                      value={formField.value as number | null}
                      type={
                        field.type === ColumnType.INTEGER ? ColumnType.INTEGER : ColumnType.FLOAT
                      }
                      onChange={formField.onChange}
                      nullable={field.isNullable}
                      tableName={tableName}
                      field={field}
                    />
                  )}
                />
              </FieldWithLink>
            </div>
          </div>
        );

      case ColumnType.DATE:
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
                      value={formField.value as string | null}
                      type={field.type as ColumnType.DATE | ColumnType.DATETIME}
                      onChange={formField.onChange}
                      nullable={field.isNullable}
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
                            : String(formField.value || '')
                        }
                        nullable={field.isNullable}
                        hasForeignKey={!!field.foreignKey}
                        onChange={(newValue) => {
                          const result = convertValueForColumn(ColumnType.JSON, newValue as string);
                          if (result.success) {
                            formField.onChange(result.value);
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
          {(errors[field.columnName] as FieldError)?.message || `${field.columnName} is required`}
        </p>
      )}
    </div>
  );
}
