import { Trash2 } from 'lucide-react';
import { Button } from '@/components/radix/Button';
import { Secret } from '@insforge/shared-schemas';
import { cn } from '@/lib/utils/utils';
import { formatDistance } from 'date-fns';

interface SecretRowProps {
  secret: Secret;
  onDelete: (secret: Secret) => void;
  className?: string;
}

export function SecretRow({ secret, onDelete, className }: SecretRowProps) {
  const handleDeleteClick = (e: React.MouseEvent) => {
    e.stopPropagation();
    onDelete(secret);
  };

  return (
    <div
      className={cn(
        'group h-14 px-3 bg-white hover:bg-neutral-100 dark:bg-[#333333] dark:hover:bg-neutral-700 rounded-[8px] transition-all',
        className
      )}
    >
      <div className="grid grid-cols-12 h-full items-center">
        {/* Name Column */}
        <div className="col-span-8 min-w-0 px-3 py-1.5">
          <p
            className="text-sm text-zinc-950 dark:text-white truncate font-medium"
            title={secret.key}
          >
            {secret.key}
          </p>
        </div>

        {/* Digest Column */}
        {/* <div className="col-span-5 min-w-0 px-3 py-1.5">
          <span className="text-sm text-zinc-950 dark:text-white font-mono truncate">
          </span>
        </div> */}

        {/* Updated at Column */}
        <div className="col-span-3 px-3 py-1.5">
          <span className="text-sm text-zinc-950 dark:text-white truncate">
            {secret.updatedAt
              ? formatDistance(new Date(secret.updatedAt), new Date(), { addSuffix: true })
              : 'Never'}
          </span>
        </div>

        {/* Delete Button Column */}
        <div className="col-span-1 flex justify-end px-3 py-1.5">
          <Button
            variant="ghost"
            size="sm"
            onClick={handleDeleteClick}
            disabled={secret.isReserved}
            className="h-7 w-7 p-1 text-neutral-500 dark:text-neutral-400 hover:text-black dark:hover:text-white hover:bg-neutral-200 dark:hover:bg-neutral-600"
            title={secret.isReserved ? 'Cannot delete reserved secrets' : 'Delete secret'}
          >
            <Trash2 className="w-5 h-5" />
          </Button>
        </div>
      </div>
    </div>
  );
}
