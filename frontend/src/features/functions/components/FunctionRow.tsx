import { CopyButton } from '@insforge/ui';
import { FunctionSchema } from '@insforge/shared-schemas';
import { cn, getBackendUrl } from '@/lib/utils/utils';
import { format, formatDistance } from 'date-fns';
interface FunctionRowProps {
  function: FunctionSchema;
  onClick: () => void;
  className?: string;
  deploymentUrl?: string | null;
}

export function FunctionRow({
  function: func,
  onClick,
  className,
  deploymentUrl,
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
      </div>
    </div>
  );
}
