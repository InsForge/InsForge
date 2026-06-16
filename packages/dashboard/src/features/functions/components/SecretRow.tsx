import { Eye, EyeOff, Loader2, Trash2 } from 'lucide-react';
import { Button, CopyButton } from '@insforge/ui';
import { SecretSchema } from '@insforge/shared-schemas';
import { cn } from '#lib/utils/utils';
import { ListRow, ListRowCell } from '#components';
import { formatDistance } from 'date-fns';
import { useSecretValue } from '#features/functions/hooks/useSecrets';

interface SecretRowProps {
  secret: SecretSchema;
  onDelete: (secret: SecretSchema) => void;
  className?: string;
}

export function SecretRow({ secret, onDelete, className }: SecretRowProps) {
  const { isValueVisible, valueError, revealedSecret, isFetchingValue, toggleValue } =
    useSecretValue(secret);

  const handleDeleteClick = (e: React.MouseEvent) => {
    e.stopPropagation();
    onDelete(secret);
  };

  const handleToggleValue = async (e: React.MouseEvent) => {
    e.stopPropagation();
    await toggleValue();
  };

  const maskedValue = '************';
  const displayedValue =
    isValueVisible && revealedSecret ? revealedSecret.value : (valueError ?? maskedValue);
  const valueTitle =
    isValueVisible && revealedSecret ? revealedSecret.value : (valueError ?? 'Reveal secret value');

  return (
    <ListRow className={className} contentClassName="pl-1.5">
      {/* Name Column */}
      <ListRowCell className="flex-1 min-w-0">
        <p className="text-sm text-foreground truncate" title={secret.key}>
          {secret.key}
        </p>
      </ListRowCell>

      {/* Value Column */}
      <ListRowCell className="flex-[1.5] min-w-0 gap-2">
        <Button
          variant="ghost"
          size="icon-sm"
          onClick={(e) => void handleToggleValue(e)}
          disabled={isFetchingValue}
          className="size-7 shrink-0 rounded text-muted-foreground hover:text-foreground"
          title={isValueVisible ? 'Hide secret value' : 'Reveal secret value'}
          aria-label={
            isValueVisible ? `Hide value for ${secret.key}` : `Reveal value for ${secret.key}`
          }
        >
          {isFetchingValue ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : isValueVisible ? (
            <EyeOff className="h-4 w-4" />
          ) : (
            <Eye className="h-4 w-4" />
          )}
        </Button>
        <span
          className={cn(
            'min-w-0 flex-1 truncate text-sm',
            isValueVisible && revealedSecret
              ? 'font-mono text-foreground'
              : 'text-muted-foreground',
            valueError && 'text-destructive'
          )}
          title={valueTitle}
        >
          {displayedValue}
        </span>
        {isValueVisible && revealedSecret ? (
          <CopyButton
            showText={false}
            text={revealedSecret.value}
            copyText="Copy secret value"
            copiedText="Copied secret value"
            className="size-6 shrink-0"
          />
        ) : null}
      </ListRowCell>

      {/* Updated at Column */}
      <ListRowCell className="flex-1 min-w-0">
        <span className="text-sm text-foreground truncate">
          {secret.updatedAt
            ? formatDistance(new Date(secret.updatedAt), new Date(), { addSuffix: true })
            : 'Never'}
        </span>
      </ListRowCell>

      {/* Delete Button Column */}
      <ListRowCell className="w-12 justify-end">
        {!secret.isReserved && (
          <Button
            variant="ghost"
            size="icon"
            onClick={handleDeleteClick}
            className="size-8 p-1.5 text-muted-foreground hover:text-foreground hover:bg-[var(--alpha-8)] opacity-0 group-hover:opacity-100 transition-opacity"
            title="Delete secret"
          >
            <Trash2 className="w-5 h-5" />
          </Button>
        )}
      </ListRowCell>
    </ListRow>
  );
}
