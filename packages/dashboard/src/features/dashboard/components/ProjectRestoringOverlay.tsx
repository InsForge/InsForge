import { Loader2 } from 'lucide-react';
import { useDashboardProject } from '../../../lib/config/DashboardHostContext';

export function ProjectRestoringOverlay() {
  const project = useDashboardProject();
  const projectName = project?.name?.trim() || 'This project';

  return (
    <div className="absolute inset-0 z-40 flex items-center justify-center bg-[var(--alpha-16)] px-4 backdrop-blur-[2px]">
      <div className="flex w-full max-w-[560px] flex-col rounded-lg border border-[var(--alpha-8)] bg-card p-6 shadow-[0_8px_12px_rgba(0,0,0,0.16)]">
        <div className="flex flex-col items-center gap-4 text-center">
          <div className="flex h-14 w-14 items-center justify-center rounded-full border border-[var(--alpha-8)] bg-[rgb(var(--semantic-1))]">
            <Loader2 className="h-7 w-7 animate-spin text-muted-foreground" />
          </div>

          <div className="space-y-2">
            <h2 className="text-xl font-medium leading-7 text-foreground">Restoring Database</h2>
            <p className="text-sm leading-6 text-foreground">
              {projectName} is currently being restored from a backup.
            </p>
            <p className="text-sm leading-6 text-muted-foreground">
              The process may take a few minutes. You can still navigate with the sidebar while the
              restore is in progress.
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
