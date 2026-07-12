import type { ScheduleSchema } from '@insforge/shared-schemas';
import { format } from 'date-fns';
import { useTranslation } from 'react-i18next';
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
import { ListRow, ListRowCell } from '#components';

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
  const { t } = useTranslation('chrome');
  return (
    <ListRow className={className} contentClassName="pl-2" onClick={onClick}>
      {/* Name Column */}
      <ListRowCell className="flex-1 min-w-0">
        <p className="text-sm text-foreground truncate" title={schedule.name}>
          {schedule.name}
        </p>
      </ListRowCell>

      {/* Function URL Column */}
      <ListRowCell className="flex-[2] min-w-0">
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
      </ListRowCell>

      {/* Next Run Column */}
      <ListRowCell className="flex-1 min-w-0">
        <span className="text-sm text-foreground truncate" title={schedule.nextRun ?? ''}>
          {schedule.isActive
            ? schedule.nextRun
              ? format(new Date(schedule.nextRun), 'MMM dd, yyyy HH:mm')
              : t('functions.notScheduled', { defaultValue: 'Not scheduled' })
            : t('functions.inactive', { defaultValue: 'Inactive' })}
        </span>
      </ListRowCell>

      {/* Last Run Column */}
      <ListRowCell className="flex-1 min-w-0">
        <span className="text-sm text-foreground truncate" title={schedule.lastExecutedAt ?? ''}>
          {schedule.lastExecutedAt
            ? format(new Date(schedule.lastExecutedAt), 'MMM dd, yyyy HH:mm')
            : t('functions.never', { defaultValue: 'Never' })}
        </span>
      </ListRowCell>

      {/* Created Column */}
      <ListRowCell className="flex-1 min-w-0">
        <span className="text-sm text-foreground truncate" title={schedule.createdAt}>
          {format(new Date(schedule.createdAt), 'MMM dd, yyyy HH:mm')}
        </span>
      </ListRowCell>

      {/* Active Toggle Column */}
      <ListRowCell className="w-[60px] shrink-0" onClick={(e) => e.stopPropagation()}>
        <Switch
          checked={Boolean(schedule.isActive)}
          onCheckedChange={(next) => onToggle(schedule.id, next)}
          disabled={isLoading}
          aria-label={t('functions.activeToggleAria', {
            name: schedule.name,
            defaultValue: '{{name}} active toggle',
          })}
        />
      </ListRowCell>

      {/* Actions Column */}
      <ListRowCell className="w-12 shrink-0 justify-end" onClick={(e) => e.stopPropagation()}>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              variant="ghost"
              size="icon-sm"
              title={t('functions.actionsFor', {
                name: schedule.name,
                defaultValue: 'Actions for {{name}}',
              })}
            >
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
              <span>{t('functions.edit', { defaultValue: 'Edit' })}</span>
            </DropdownMenuItem>
            <DropdownMenuItem onSelect={() => onDelete(schedule.id)} className="text-destructive">
              <Trash2 className="mr-2 h-4 w-4" />
              <span>{t('functions.delete', { defaultValue: 'Delete' })}</span>
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </ListRowCell>
    </ListRow>
  );
}

export default ScheduleRow;
