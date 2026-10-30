import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue, cn } from '@insforge/ui';
import { useTranslation } from 'react-i18next';
import type { DatabaseSchemaInfo } from '@insforge/shared-schemas';

interface DatabaseSchemaSelectProps {
  schemas: DatabaseSchemaInfo[];
  value: string;
  onValueChange: (value: string) => void;
  disabled?: boolean;
  className?: string;
}

export function DatabaseSchemaSelect({
  schemas,
  value,
  onValueChange,
  disabled,
  className,
}: DatabaseSchemaSelectProps) {
  const { t } = useTranslation('chrome');
  return (
    <Select value={value} onValueChange={onValueChange} disabled={disabled}>
      <SelectTrigger className={cn('w-full', className)}>
        <SelectValue placeholder={t('database.selectSchema', { defaultValue: 'Select schema' })} />
      </SelectTrigger>
      <SelectContent align="start">
        {schemas.map((schema) => (
          <SelectItem key={schema.name} value={schema.name}>
            <span>{schema.name}</span>
            {schema.isProtected && (
              <span className="ml-1 text-xs text-muted-foreground">
                {t('database.protectedSuffix', { defaultValue: '(Protected)' })}
              </span>
            )}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
