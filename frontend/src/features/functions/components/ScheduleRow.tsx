import { cn } from '@/lib/utils/utils';
import type { ScheduleSchema } from '@insforge/shared-schemas';
import { format } from 'date-fns';
import { MoreHorizontal, Pencil, Trash2 } from 'lucide-react';
import { Switch } from '@/components/radix/Switch';
import { Button } from '@/components/radix/Button';
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
} from '@/components/radix/DropdownMenu';
import { CopyButton } from '@/components/CopyButton';

interface ScheduleRowProps {
  schedule: ScheduleSchema;
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
              variant="secondary"
              showText={false}
              text={schedule.functionUrl}
              className="h-7 w-7"
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

        <div
          className="col-span-1 min-w-0 px-3 py-1.5 flex items-center"
          onClick={(e) => e.stopPropagation()}
        >
          <Switch
            checked={Boolean(schedule.isActive)}
            onCheckedChange={(next) => onToggle(schedule.id, next)}
            disabled={isLoading}
            aria-label={`${schedule.name} active toggle`}
          />
        </div>

        <div
          className="col-span-1 min-w-0 px-3 py-1.5 flex items-center justify-end"
          onClick={(e) => e.stopPropagation()}
        >
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                variant="ghost"
                size="icon"
                className="h-7 w-7 hover:bg-zinc-200 dark:hover:bg-neutral-600"
                title={`Actions for ${schedule.name}`}
              >
                <MoreHorizontal className="h-4 w-4 text-zinc-500 dark:text-zinc-300" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent
              sideOffset={6}
              className="w-40"
              onCloseAutoFocus={(e) => e.preventDefault()}
            >
              <DropdownMenuItem onSelect={() => onEdit(schedule.id)}>
                <Pencil className="mr-2 h-4 w-4 text-zinc-700 dark:text-zinc-300" />
                <span>Edit</span>
              </DropdownMenuItem>
              <DropdownMenuItem
                onSelect={() => onDelete(schedule.id)}
                className="text-destructive dark:text-red-400"
              >
                <Trash2 className="mr-2 h-4 w-4 text-destructive dark:text-red-400" />
                <span>Delete</span>
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>
    </div>
  );
}

export default ScheduleRow;
