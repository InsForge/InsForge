import { CopyButton } from '@/components/CopyButton';
import { FunctionSchema } from '@insforge/shared-schemas';
import { cn, getBackendUrl } from '@/lib/utils/utils';
import { format, formatDistance } from 'date-fns';
interface FunctionRowProps {
  function: FunctionSchema;
  onClick: () => void;
  className?: string;
  deploymentUrl?: string | null;
}

export function FunctionRow({ function: func, onClick, className, deploymentUrl }: FunctionRowProps) {
  // Use deployment URL if available (cloud mode), otherwise fall back to proxy URL
  const functionUrl = deploymentUrl
    ? `${deploymentUrl}/${func.slug}`
    : `${getBackendUrl()}/functions/${func.slug}`;

  return (
    <div
      className={cn(
        'group h-14 px-3 bg-white hover:bg-neutral-100 dark:bg-[#333333] dark:hover:bg-neutral-700 rounded-[8px] transition-all cursor-pointer',
        className
      )}
      onClick={onClick}
    >
      <div className="grid grid-cols-12 h-full items-center">
        {/* Name Column */}
        <div className="col-span-2 min-w-0 px-3 py-1.5">
          <p className="text-sm text-zinc-950 dark:text-white truncate" title={func.name}>
            {func.name}
          </p>
        </div>

        {/* URL Column */}
        <div className="col-span-6 min-w-0 px-3 py-1.5">
          <div className="flex items-center gap-3">
            <span
              className="text-sm text-muted-foreground dark:text-white truncate"
              title={functionUrl}
            >
              {functionUrl}
            </span>
            <CopyButton
              variant="secondary"
              showText={false}
              text={functionUrl}
              className="h-7 w-7"
            />
          </div>
        </div>

        {/* Created Column */}
        <div className="col-span-2 px-3 py-1.5">
          <span
            className="text-sm text-muted-foreground dark:text-white truncate"
            title={func.createdAt}
          >
            {format(new Date(func.createdAt), 'MMM dd, yyyy HH:mm')}
          </span>
        </div>

        {/* Last Update Column */}
        <div className="col-span-2 px-3 py-1.5">
          <span
            className="text-sm text-muted-foreground dark:text-white truncate"
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
