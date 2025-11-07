import { MoreVertical, Trash2, Eye } from 'lucide-react';
import { Button } from '@/components/radix/Button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/radix/DropdownMenu';
import type { ScheduleRow } from '@/features/functions/components/CronJobsContent.js';

interface ScheduleActionsCellProps {
  row: ScheduleRow;
  onViewDetails: (schedule: ScheduleRow) => void;
  onDelete: (scheduleId: string) => void;
}

export function ScheduleActionsCell({ row, onViewDetails, onDelete }: ScheduleActionsCellProps) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="sm" className="h-8 w-8 p-0">
          <MoreVertical className="h-4 w-4" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <DropdownMenuItem onClick={() => onViewDetails(row)} className="cursor-pointer">
          <Eye className="h-4 w-4 mr-2" />
          View Details
        </DropdownMenuItem>
        <DropdownMenuItem
          onClick={() => onDelete(row.id)}
          className="cursor-pointer text-destructive dark:text-red-400"
        >
          <Trash2 className="h-4 w-4 mr-2" />
          Delete
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
