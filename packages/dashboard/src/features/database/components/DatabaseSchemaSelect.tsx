import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@insforge/ui';
import type { DatabaseSchemaInfo } from '@insforge/shared-schemas';
import { cn } from '#lib/utils/utils';

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
  return (
    <Select value={value} onValueChange={onValueChange} disabled={disabled}>
      <SelectTrigger className={cn('w-full', className)}>
        <SelectValue placeholder="Select schema" />
      </SelectTrigger>
      <SelectContent align="start">
        {schemas.map((schema) => (
          <SelectItem key={schema.name} value={schema.name}>
            <span>{schema.name}</span>
            {schema.isProtected && (
              <span className="ml-1 text-xs text-muted-foreground">(Protected)</span>
            )}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
