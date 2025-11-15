import { cn } from '@/lib/utils/utils';
import type { ScheduleRow as ScheduleRowType } from '../types/schedules';
import { format } from 'date-fns';
import ActionMenu from './ActionMenu';
import { ScheduleToggleCell } from './ScheduleToggleCell';
import { CopyButton } from '@/components/CopyButton';

interface ScheduleRowProps {
  schedule: ScheduleRowType;
  onClick: () => void;
  onEdit: (id: string) => void;
  onDelete: (id: string) => void;
  onToggle: (scheduleId: string, isActive: boolean) => void;
  isLoading?: boolean;
  className?: string;
}

export function ScheduleRow({
  schedule,
  onClick,
  onEdit,
  onDelete,
  onToggle,
  isLoading,
  className,
}: ScheduleRowProps) {
  return (
    <div
      className={cn(
        'group h-14 px-3 bg-white hover:bg-neutral-100 dark:bg-[#333333] dark:hover:bg-neutral-700 rounded-[8px] transition-all cursor-pointer',
        className
      )}
      onClick={onClick}
    >
      <div className="grid grid-cols-14 gap-x-1 h-full items-center">
        <div className="col-span-2 min-w-0 px-3 py-1.5">
          <p className="text-sm text-zinc-950 dark:text-white truncate" title={schedule.name}>
            {schedule.name}
          </p>
        </div>

        <div className="col-span-4 min-w-0 px-3 py-1.5">
          <div className="flex items-center gap-3 min-w-0">
            <span
              className="text-sm text-muted-foreground dark:text-white truncate min-w-0"
              title={schedule.functionUrl}
            >
              {schedule.functionUrl}
            </span>
            <CopyButton
              showText={false}
              text={schedule.functionUrl}
              className="h-7 w-7 dark:hover:bg-neutral-500 dark:data-[copied=true]:group-hover:bg-neutral-700 dark:data-[copied=true]:hover:bg-neutral-700"
            />
          </div>
        </div>
        <div className="col-span-2 min-w-0 px-3 py-1.5">
          <span
            className="text-sm text-muted-foreground dark:text-white truncate"
            title={schedule.nextRun ?? ''}
          >
            {schedule.isActive
              ? schedule.nextRun
                ? format(new Date(schedule.nextRun), 'MMM dd, yyyy HH:mm')
                : 'Not scheduled'
              : 'Inactive'}
          </span>
        </div>

        <div className="col-span-2 min-w-0 px-3 py-1.5">
          <span
            className="text-sm text-muted-foreground dark:text-white truncate"
            title={schedule.lastExecutedAt ?? ''}
          >
            {schedule.lastExecutedAt
              ? format(new Date(schedule.lastExecutedAt), 'MMM dd, yyyy HH:mm')
              : 'Never'}
          </span>
        </div>

        <div className="col-span-2 min-w-0 px-3 py-1.5">
          <span
            className="text-sm text-muted-foreground dark:text-white truncate"
            title={schedule.createdAt}
          >
            {format(new Date(schedule.createdAt), 'MMM dd, yyyy HH:mm')}
          </span>
        </div>

        <div className="col-span-1 min-w-0 px-3 py-1.5 flex items-center justify-center">
          <div onClick={(e) => e.stopPropagation()}>
            <ScheduleToggleCell row={schedule} isLoading={Boolean(isLoading)} onToggle={onToggle} />
          </div>
        </div>

        <div
          className="col-span-1 min-w-0 px-3 py-1.5 flex items-center justify-end"
          onClick={(e) => e.stopPropagation()}
        >
          <ActionMenu
            ariaLabel={`Actions for ${schedule.name}`}
            onEdit={() => onEdit(schedule.id)}
            onDelete={() => onDelete(schedule.id)}
          />
        </div>
      </div>
    </div>
  );
}

export default ScheduleRow;
