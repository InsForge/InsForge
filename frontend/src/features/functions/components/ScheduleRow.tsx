import { cn } from '@/lib/utils/utils';
import type { ScheduleSchema } from '@insforge/shared-schemas';
import { format } from 'date-fns';
import { MoreVertical, Pencil, Trash2 } from 'lucide-react';
import {
  Button,
  CopyButton,
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
  Switch,
} from '@insforge/ui';

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
        'group rounded border border-[var(--alpha-8)] bg-card cursor-pointer',
        className
      )}
      onClick={onClick}
    >
      <div className="flex items-center pl-2 rounded hover:bg-[var(--alpha-8)] transition-colors">
        {/* Name Column */}
        <div className="flex-1 min-w-0 h-12 flex items-center px-2.5">
          <p className="text-sm text-foreground truncate" title={schedule.name}>
            {schedule.name}
          </p>
        </div>

        {/* Function URL Column */}
        <div className="flex-[2] min-w-0 h-12 flex items-center px-2.5">
          <div className="flex items-center gap-2 min-w-0">
            <span className="text-sm text-foreground truncate" title={schedule.functionUrl}>
              {schedule.functionUrl}
            </span>
            <CopyButton
              showText={false}
              text={schedule.functionUrl}
              className="size-6 shrink-0 opacity-0 transition-opacity group-hover:opacity-100"
            />
          </div>
        </div>

        {/* Next Run Column */}
        <div className="flex-1 min-w-0 h-12 flex items-center px-2.5">
          <span className="text-sm text-foreground truncate" title={schedule.nextRun ?? ''}>
            {schedule.isActive
              ? schedule.nextRun
                ? format(new Date(schedule.nextRun), 'MMM dd, yyyy HH:mm')
                : 'Not scheduled'
              : 'Inactive'}
          </span>
        </div>

        {/* Last Run Column */}
        <div className="flex-1 min-w-0 h-12 flex items-center px-2.5">
          <span className="text-sm text-foreground truncate" title={schedule.lastExecutedAt ?? ''}>
            {schedule.lastExecutedAt
              ? format(new Date(schedule.lastExecutedAt), 'MMM dd, yyyy HH:mm')
              : 'Never'}
          </span>
        </div>

        {/* Created Column */}
        <div className="flex-1 min-w-0 h-12 flex items-center px-2.5">
          <span className="text-sm text-foreground truncate" title={schedule.createdAt}>
            {format(new Date(schedule.createdAt), 'MMM dd, yyyy HH:mm')}
          </span>
        </div>

        {/* Active Toggle Column */}
        <div
          className="w-[60px] shrink-0 h-12 flex items-center px-2.5"
          onClick={(e) => e.stopPropagation()}
        >
          <Switch
            checked={Boolean(schedule.isActive)}
            onCheckedChange={(next) => onToggle(schedule.id, next)}
            disabled={isLoading}
            aria-label={`${schedule.name} active toggle`}
          />
        </div>

        {/* Actions Column */}
        <div
          className="w-12 shrink-0 h-12 flex items-center justify-end px-2.5"
          onClick={(e) => e.stopPropagation()}
        >
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" size="icon-sm" title={`Actions for ${schedule.name}`}>
                <MoreVertical className="w-4 h-4" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent
              sideOffset={6}
              className="w-40"
              onCloseAutoFocus={(e) => e.preventDefault()}
            >
              <DropdownMenuItem onSelect={() => onEdit(schedule.id)}>
                <Pencil className="mr-2 h-4 w-4" />
                <span>Edit</span>
              </DropdownMenuItem>
              <DropdownMenuItem onSelect={() => onDelete(schedule.id)} className="text-destructive">
                <Trash2 className="mr-2 h-4 w-4" />
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
