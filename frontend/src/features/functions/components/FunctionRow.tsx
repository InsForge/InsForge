import { Button, CopyButton } from '@insforge/ui';
import { FunctionSchema } from '@insforge/shared-schemas';
import { cn, getBackendUrl } from '@/lib/utils/utils';
import { format, formatDistance } from 'date-fns';
import { Trash2 } from 'lucide-react';

interface FunctionRowProps {
  function: FunctionSchema;
  onClick: () => void;
  onDelete: () => void;
  className?: string;
  deploymentUrl?: string | null;
  isDeleting?: boolean;
}

export function FunctionRow({
  function: func,
  onClick,
  onDelete,
  className,
  deploymentUrl,
  isDeleting,
}: FunctionRowProps) {
  // Use deployment URL if available (cloud mode), otherwise fall back to proxy URL
  const functionUrl = deploymentUrl
    ? `${deploymentUrl}/${func.slug}`
    : `${getBackendUrl()}/functions/${func.slug}`;

  return (
    <div
      className={cn(
        'group rounded border border-[var(--alpha-8)] bg-card cursor-pointer',
        className
      )}
      onClick={onClick}
    >
      <div className="flex items-center pl-2 rounded hover:bg-[var(--alpha-8)] transition-colors">
        {/* Name Column */}
        <div className="flex-[1.5] min-w-0 h-12 flex items-center px-2.5">
          <p className="text-sm leading-[18px] text-foreground truncate" title={func.name}>
            {func.name}
          </p>
        </div>

        {/* URL Column */}
        <div className="flex-[3] min-w-0 h-12 flex items-center px-2.5">
          <div className="flex items-center gap-2 min-w-0">
            <span className="text-sm leading-[18px] text-foreground truncate" title={functionUrl}>
              {functionUrl}
            </span>
            <CopyButton
              showText={false}
              text={functionUrl}
              className="size-6 shrink-0 opacity-0 transition-opacity group-hover:opacity-100"
            />
          </div>
        </div>

        {/* Created Column */}
        <div className="flex-[1.5] min-w-0 h-12 flex items-center px-2.5">
          <span className="text-sm leading-[18px] text-foreground truncate" title={func.createdAt}>
            {format(new Date(func.createdAt), 'MMM dd, yyyy, hh:mm a')}
          </span>
        </div>

        {/* Last Update Column */}
        <div className="flex-1 min-w-0 h-12 flex items-center px-2.5">
          <span
            className="text-sm leading-[18px] text-foreground truncate"
            title={func.deployedAt ?? ''}
          >
            {func.deployedAt
              ? formatDistance(new Date(func.deployedAt), new Date(), { addSuffix: true })
              : 'Never'}
          </span>
        </div>

        {/* Delete Button Column */}
        <div
          className="w-12 h-12 flex items-center justify-end px-2.5"
          onClick={(event) => event.stopPropagation()}
        >
          <Button
            variant="ghost"
            size="icon"
            onClick={(event) => {
              event.stopPropagation();
              onDelete();
            }}
            disabled={isDeleting}
            className="size-8 p-1.5 text-muted-foreground hover:text-foreground hover:bg-[var(--alpha-8)] opacity-0 transition-opacity group-hover:opacity-100 focus:opacity-100 focus-visible:opacity-100 focus:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
            title="Delete function"
            aria-label={`Delete function ${func.name}`}
          >
            <Trash2 className="w-5 h-5" />
          </Button>
        </div>
      </div>
    </div>
  );
}
