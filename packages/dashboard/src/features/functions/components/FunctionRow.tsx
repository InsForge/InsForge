import { CopyButton } from '@insforge/ui';
import { FunctionSchema } from '@insforge/shared-schemas';
import { getBackendUrl } from '#lib/utils/utils';
import { ListRow, ListRowCell } from '#components';
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
    <ListRow className={className} contentClassName="pl-2" onClick={onClick}>
      {/* Name Column */}
      <ListRowCell className="flex-[1.5] min-w-0">
        <p className="text-sm leading-[18px] text-foreground truncate" title={func.name}>
          {func.name}
        </p>
      </ListRowCell>

      {/* URL Column */}
      <ListRowCell className="flex-[3] min-w-0">
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
      </ListRowCell>

      {/* Created Column */}
      <ListRowCell className="flex-[1.5] min-w-0">
        <span className="text-sm leading-[18px] text-foreground truncate" title={func.createdAt}>
          {format(new Date(func.createdAt), 'MMM dd, yyyy, hh:mm a')}
        </span>
      </ListRowCell>

      {/* Last Update Column */}
      <ListRowCell className="flex-1 min-w-0">
        <span
          className="text-sm leading-[18px] text-foreground truncate"
          title={func.deployedAt ?? ''}
        >
          {func.deployedAt
            ? formatDistance(new Date(func.deployedAt), new Date(), { addSuffix: true })
            : 'Never'}
        </span>
      </ListRowCell>
    </ListRow>
  );
}
