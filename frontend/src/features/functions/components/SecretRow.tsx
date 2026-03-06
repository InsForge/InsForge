import { Trash2 } from 'lucide-react';
import { Button } from '@insforge/ui';
import { SecretSchema } from '@insforge/shared-schemas';
import { cn } from '@/lib/utils/utils';
import { formatDistance } from 'date-fns';

interface SecretRowProps {
  secret: SecretSchema;
  onDelete: (secret: SecretSchema) => void;
  className?: string;
  isLast?: boolean;
}

export function SecretRow({ secret, onDelete, className, isLast }: SecretRowProps) {
  const handleDeleteClick = (e: React.MouseEvent) => {
    e.stopPropagation();
    onDelete(secret);
  };

  return (
    <div
      className={cn(
        'group flex items-center px-4 transition-colors hover:bg-[var(--alpha-4)]',
        !isLast && 'border-b border-border',
        className
      )}
    >
      {/* Name Column */}
      <div className="flex-1 min-w-0 h-14 flex items-center">
        <p className="text-sm font-medium text-foreground truncate" title={secret.key}>
          {secret.key}
        </p>
      </div>

      {/* Updated at Column */}
      <div className="flex-1 min-w-0 h-14 flex items-center">
        <span className="text-sm text-muted-foreground truncate">
          {secret.updatedAt
            ? formatDistance(new Date(secret.updatedAt), new Date(), { addSuffix: true })
            : 'Never'}
        </span>
      </div>

      {/* Delete Button Column */}
      <div className="w-12 h-14 flex items-center justify-end">
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
      </div>
    </div>
  );
}
