import { Trash2 } from 'lucide-react';
import { Button } from '@insforge/ui';
import { SecretSchema } from '@insforge/shared-schemas';
import { cn } from '@/lib/utils/utils';
import { formatDistance } from 'date-fns';

interface SecretRowProps {
  secret: SecretSchema;
  onDelete: (secret: SecretSchema) => void;
  className?: string;
}

export function SecretRow({ secret, onDelete, className }: SecretRowProps) {
  const handleDeleteClick = (e: React.MouseEvent) => {
    e.stopPropagation();
    onDelete(secret);
  };

  return (
    <div className={cn('group rounded border border-[var(--alpha-8)] bg-card', className)}>
      <div className="flex items-center pl-1.5 rounded hover:bg-[var(--alpha-8)] transition-colors">
        {/* Name Column */}
        <div className="flex-1 min-w-0 h-12 flex items-center px-2.5">
          <p className="text-sm text-foreground truncate" title={secret.key}>
            {secret.key}
          </p>
        </div>

        {/* Updated at Column */}
        <div className="flex-1 min-w-0 h-12 flex items-center px-2.5">
          <span className="text-sm text-foreground truncate">
            {secret.updatedAt
              ? formatDistance(new Date(secret.updatedAt), new Date(), { addSuffix: true })
              : 'Never'}
          </span>
        </div>

        {/* Delete Button Column */}
        <div className="w-12 h-12 flex items-center justify-end px-2.5">
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
    </div>
  );
}
