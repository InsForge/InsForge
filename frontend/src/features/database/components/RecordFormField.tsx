import { useState, type ReactNode } from 'react';
import { Control, Controller, FieldError, UseFormReturn } from 'react-hook-form';
import { Calendar, Clock, Link2, X } from 'lucide-react';
import { Button, Input } from '@insforge/ui';
import {
  BooleanCellEditor,
  DateCellEditor,
  JsonCellEditor,
  type DatabaseRecord,
  type ConvertedValue,
} from '@/components';
import { ColumnSchema, ColumnType } from '@insforge/shared-schemas';
import { convertValueForColumn, cn, formatValueForDisplay } from '@/lib/utils/utils';
import { LinkRecordDialog } from '@/features/database/components/LinkRecordDialog';
import { isValid, parseISO } from 'date-fns';

function getPlaceholderText(field: ColumnSchema): string {
  if (field.defaultValue && field.defaultValue.endsWith('()')) {
    return 'Auto-generated on submit';
  }
  return field.isNullable ? 'Optional' : 'Required';
}

function FormMetaBadge({ children }: { children: ReactNode }) {
  return (
    <span className="inline-flex items-center rounded bg-[var(--alpha-8)] px-1 py-0.5 text-[11px] leading-4 text-muted-foreground">
      {children}
    </span>
  );
}

interface BaseFormEditorProps {
  nullable: boolean;
  onChange: (value: ConvertedValue) => void;
}

interface FormBooleanEditorProps extends BaseFormEditorProps {
  value: boolean | null;
}

function FormBooleanEditor({ value, nullable, onChange }: FormBooleanEditorProps) {
  const handleValueChange = (newValue: string) => {
    if (newValue === 'null') {
      onChange(null);
    } else {
      onChange(newValue === 'true');
    }
  };

  return (
    <BooleanCellEditor
      value={value}
      nullable={nullable}
      onValueChange={handleValueChange}
      onCancel={() => {}}
      autoOpen={false}
      className={cn(
        'h-8 w-full justify-start rounded border border-[var(--alpha-8)] bg-[var(--alpha-4)] px-2 py-1.5 text-[13px] font-normal leading-[18px] shadow-none',
        value === null && 'text-muted-foreground italic'
      )}
    />
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
        className="h-8 border px-2 py-1.5"
      />
    );
  }

  return (
    <Button
      type="button"
      variant="secondary"
      onClick={() => setShowEditor(true)}
      className={cn(
        'h-8 w-full justify-start rounded bg-[var(--alpha-4)] px-2 py-1.5 text-[13px] font-normal leading-[18px]',
        (!value || value === 'null') && 'text-muted-foreground'
      )}
    >
      {type === ColumnType.DATETIME ? (
        <Clock className="mr-1.5 h-4 w-4" />
      ) : (
        <Calendar className="mr-1.5 h-4 w-4" />
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
          onChange(null);
        } else {
          const numValue =
            type === ColumnType.INTEGER ? parseInt(inputValue, 10) : parseFloat(inputValue);
          onChange(isNaN(numValue) ? null : numValue);
        }
      }}
      placeholder={getPlaceholderText(field)}
      className="h-8 rounded px-2 py-1.5 text-[13px] leading-[18px]"
    />
  );
}

interface FormJsonEditorProps extends BaseFormEditorProps {
  value: string | null;
}

function FormJsonEditor({ value, nullable, onChange }: FormJsonEditorProps) {
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
        className="h-8 border px-2 py-1.5"
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
      variant="secondary"
      onClick={() => setShowEditor(true)}
      className={cn(
        'h-8 w-full justify-start rounded bg-[var(--alpha-4)] px-2 py-1.5 text-[13px] font-normal leading-[18px]',
        (!value || value === 'null') && 'text-muted-foreground'
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

function FieldLabel({ field, tableName }: { field: ColumnSchema; tableName: string }) {
  return (
    <label
      htmlFor={`${tableName}-${field.columnName}`}
      className="flex min-h-8 items-center gap-1 py-1.5 text-sm leading-5 text-foreground"
    >
      {!field.isNullable && <span className="text-destructive">*</span>}
      <span className="truncate" title={field.columnName}>
        {field.columnName}
      </span>
      <FormMetaBadge>{field.type}</FormMetaBadge>
    </label>
  );
}

interface FieldWithLinkProps {
  field: ColumnSchema;
  control: Control<DatabaseRecord>;
  children: ReactNode;
}

function FieldWithLink({ field, control, children }: FieldWithLinkProps) {
  if (!field.foreignKey) {
    return <>{children}</>;
  }

  const foreignKey = field.foreignKey;

  return (
    <Controller
      control={control}
      name={field.columnName}
      render={({ field: formField }) => {
        const hasLinkedValue =
          formField.value !== null &&
          formField.value !== undefined &&
          String(formField.value).length > 0;

        return (
          <div className="flex min-w-0 items-start gap-1.5">
            <div className="min-w-0 flex-1">{children}</div>
            {hasLinkedValue && (
              <Button
                type="button"
                variant="secondary"
                size="icon"
                onClick={() => formField.onChange('')}
                className="h-8 w-8 shrink-0 rounded border border-[var(--alpha-8)] bg-card p-0"
                title="Clear linked record"
              >
                <X className="h-4 w-4" />
              </Button>
            )}
            <LinkRecordDialog
              referenceTable={foreignKey.referenceTable}
              referenceColumn={foreignKey.referenceColumn}
              onSelectRecord={(record: DatabaseRecord) => {
                const referenceValue = record[foreignKey.referenceColumn];
                const result = convertValueForColumn(field.type, String(referenceValue || ''));
                if (result.success) {
                  formField.onChange(result.value);
                } else {
                  formField.onChange(String(referenceValue || ''));
                }
              }}
            >
              {(openModal) => (
                <Button
                  type="button"
                  variant="secondary"
                  size="icon"
                  onClick={openModal}
                  className="h-8 w-8 shrink-0 rounded border border-[var(--alpha-8)] bg-card p-0"
                  title={
                    hasLinkedValue
                      ? `Change linked ${foreignKey.referenceTable} record`
                      : `Link to ${foreignKey.referenceTable} record`
                  }
                >
                  <Link2 className="h-4 w-4" />
                </Button>
              )}
            </LinkRecordDialog>
          </div>
        );
      }}
    />
  );
}

export function RecordFormField({ field, form, tableName }: RecordFormFieldProps) {
  const {
    control,
    formState: { errors },
  } = form;

  const renderInput = () => {
    switch (field.type) {
      case ColumnType.BOOLEAN:
        return (
          <Controller
            control={control}
            name={field.columnName}
            render={({ field: formField }) => (
              <FormBooleanEditor
                value={formField.value as boolean | null}
                nullable={field.isNullable}
                onChange={formField.onChange}
              />
            )}
          />
        );

      case ColumnType.INTEGER:
      case ColumnType.FLOAT:
        return (
          <Controller
            control={control}
            name={field.columnName}
            render={({ field: formField }) => (
              <FormNumberEditor
                value={formField.value as number | null}
                type={field.type === ColumnType.INTEGER ? ColumnType.INTEGER : ColumnType.FLOAT}
                onChange={formField.onChange}
                nullable={field.isNullable}
                tableName={tableName}
                field={field}
              />
            )}
          />
        );

      case ColumnType.DATE:
      case ColumnType.DATETIME:
        return (
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
        );

      case ColumnType.JSON:
        return (
          <Controller
            control={control}
            name={field.columnName}
            render={({ field: formField }) => (
              <FormJsonEditor
                value={
                  typeof formField.value === 'object'
                    ? JSON.stringify(formField.value)
                    : String(formField.value || '')
                }
                nullable={field.isNullable}
                onChange={(newValue) => {
                  const result = convertValueForColumn(ColumnType.JSON, newValue as string);
                  if (result.success) {
                    formField.onChange(result.value);
                  } else {
                    formField.onChange(newValue);
                  }
                }}
              />
            )}
          />
        );

      case ColumnType.UUID:
        return (
          <Controller
            control={control}
            name={field.columnName}
            render={({ field: formField }) => (
              <Input
                id={`${tableName}-${field.columnName}`}
                type="text"
                value={formField.value ? String(formField.value) : ''}
                onChange={(event) => formField.onChange(event.target.value)}
                onBlur={formField.onBlur}
                name={formField.name}
                ref={formField.ref}
                placeholder={getPlaceholderText(field)}
                className="h-8 rounded px-2 py-1.5 text-[13px] leading-[18px]"
              />
            )}
          />
        );

      case ColumnType.STRING:
      default:
        return (
          <Controller
            control={control}
            name={field.columnName}
            render={({ field: formField }) => (
              <Input
                id={`${tableName}-${field.columnName}`}
                type={field.columnName === 'password' ? 'password' : 'text'}
                value={formField.value ? String(formField.value) : ''}
                onChange={(event) => formField.onChange(event.target.value)}
                onBlur={formField.onBlur}
                name={formField.name}
                ref={formField.ref}
                placeholder={getPlaceholderText(field)}
                className="h-8 rounded px-2 py-1.5 text-[13px] leading-[18px]"
              />
            )}
          />
        );
    }
  };

  return (
    <div className="grid grid-cols-[200px_minmax(0,1fr)] items-start gap-6">
      <FieldLabel field={field} tableName={tableName} />

      <div className="min-w-0 space-y-1">
        <FieldWithLink field={field} control={control}>
          {renderInput()}
        </FieldWithLink>

        {field.foreignKey && (
          <div className="flex min-w-0 items-center gap-1.5 text-xs text-muted-foreground">
            <span className="truncate">Has a Foreign Key relation to</span>
            <FormMetaBadge>
              {field.foreignKey.referenceTable}.{field.foreignKey.referenceColumn}
            </FormMetaBadge>
          </div>
        )}

        {errors[field.columnName] && (
          <p className="text-sm leading-5 text-destructive">
            {(errors[field.columnName] as FieldError)?.message || `${field.columnName} is required`}
          </p>
        )}
      </div>
    </div>
  );
}
