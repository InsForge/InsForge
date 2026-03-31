import type { TaskRunSchema } from '@insforge/shared-schemas';

interface TaskRunsTabProps {
  taskRuns: TaskRunSchema[];
  isLoading: boolean;
  onStop: (taskRunId: string) => void;
}

export function TaskRunsTab({ taskRuns, isLoading, onStop }: TaskRunsTabProps) {
  if (isLoading) return <div className="p-4 text-sm text-muted-foreground">Loading runs...</div>;
  if (taskRuns.length === 0)
    return (
      <div className="p-4 text-sm text-muted-foreground">
        No runs yet. Click &quot;Run&quot; to start a task.
      </div>
    );

  return (
    <div className="space-y-2">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b text-left text-muted-foreground">
            <th className="p-2">Status</th>
            <th className="p-2">Exit Code</th>
            <th className="p-2">Triggered By</th>
            <th className="p-2">Started</th>
            <th className="p-2">Duration</th>
            <th className="p-2">Actions</th>
          </tr>
        </thead>
        <tbody>
          {taskRuns.map((run) => {
            const duration =
              run.startedAt && run.finishedAt
                ? `${Math.round(
                    (new Date(run.finishedAt).getTime() - new Date(run.startedAt).getTime()) / 1000
                  )}s`
                : run.startedAt
                  ? 'Running...'
                  : '-';
            return (
              <tr key={run.id} className="border-b">
                <td className="p-2">
                  <StatusBadge status={run.status} />
                </td>
                <td className="p-2 font-mono">{run.exitCode !== null ? run.exitCode : '-'}</td>
                <td className="p-2">{run.triggeredBy}</td>
                <td className="p-2">
                  {run.startedAt ? new Date(run.startedAt).toLocaleString() : '-'}
                </td>
                <td className="p-2">{duration}</td>
                <td className="p-2">
                  {['pending', 'running'].includes(run.status) && (
                    <button
                      className="text-xs text-red-500 hover:underline"
                      onClick={() => onStop(run.id)}
                    >
                      Stop
                    </button>
                  )}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function StatusBadge({ status }: { status: string }) {
  const colors: Record<string, string> = {
    pending: 'bg-yellow-100 text-yellow-800',
    running: 'bg-blue-100 text-blue-800',
    succeeded: 'bg-green-100 text-green-800',
    failed: 'bg-red-100 text-red-800',
    stopped: 'bg-gray-100 text-gray-800',
  };
  return (
    <span className={`inline-block rounded px-2 py-0.5 text-xs font-medium ${colors[status] ?? 'bg-gray-100'}`}>
      {status}
    </span>
  );
}
