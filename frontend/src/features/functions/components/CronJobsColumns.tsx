import ActionMenu from './ActionMenu';
import { ScheduleToggleCell } from '../components/ScheduleToggleCell';
import type { DataGridColumn } from '@/components/datagrid/datagridTypes';
import type { ScheduleRow } from '../types/schedules';

type ColumnsParams = {
  handleEditSchedule: (id: string) => void;
  handleDeleteSchedule: (id: string) => void;
  isTogglingStatus: boolean;
  isDeletingSchedule: boolean;
  handleToggleStatus: (scheduleId: string, isActive: boolean) => void;
};

export function getCronJobColumns({
  handleEditSchedule,
  handleDeleteSchedule,
  isTogglingStatus,
  isDeletingSchedule,
  handleToggleStatus,
}: ColumnsParams): DataGridColumn<ScheduleRow>[] {
  return [
    {
      key: 'name',
      name: 'Name',
      width: 200,
      sortable: true,
      renderCell: ({ row }) => <span className="font-medium dark:text-zinc-200">{row.name}</span>,
    },
    {
      key: 'functionUrl',
      name: 'Function URL',
      width: 300,
      sortable: true,
      renderCell: ({ row }) => (
        <span className="text-sm text-zinc-600 dark:text-zinc-400 truncate" title={row.functionUrl}>
          {row.functionUrl}
        </span>
      ),
    },
    {
      key: 'cronSchedule',
      name: 'Schedule Period',
      width: 150,
      sortable: true,
      renderCell: ({ row }) => (
        <span className="font-mono text-sm bg-zinc-100 dark:bg-neutral-700 px-2 py-1 rounded text-zinc-900 dark:text-zinc-200">
          {row.cronSchedule}
        </span>
      ),
    },
    {
      key: 'nextRun',
      name: 'Next Run',
      width: 180,
      sortable: true,
      renderCell: ({ row }) => (
        <span className="text-sm text-zinc-600 dark:text-zinc-400">
          {row.nextRun
            ? String(
                new Date(row.nextRun).toLocaleDateString() +
                  ' ' +
                  new Date(row.nextRun).toLocaleTimeString([], {
                    hour: '2-digit',
                    minute: '2-digit',
                  })
              )
            : 'Not executed yet'}
        </span>
      ),
    },
    {
      key: 'createdAt',
      name: 'Created At',
      width: 180,
      sortable: true,
      renderCell: ({ row }) => (
        <span className="text-sm text-zinc-600 dark:text-zinc-400">
          {new Date(row.createdAt).toLocaleDateString()}{' '}
          {new Date(row.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
        </span>
      ),
    },
    {
      key: 'isActive',
      name: 'Active',
      width: 140,
      sortable: false,
      renderCell: ({ row }) => (
        <ScheduleToggleCell
          row={row}
          isLoading={isTogglingStatus || isDeletingSchedule}
          onToggle={handleToggleStatus}
        />
      ),
    },
    {
      key: 'actions',
      name: '',
      width: 100,
      sortable: false,
      resizable: false,
      renderCell: ({ row }) => (
        <div className="flex items-center justify-center">
          <ActionMenu
            onEdit={() => {
              handleEditSchedule(row.id);
            }}
            onDelete={() => {
              void handleDeleteSchedule(row.id);
            }}
          />
        </div>
      ),
    },
  ];
}
