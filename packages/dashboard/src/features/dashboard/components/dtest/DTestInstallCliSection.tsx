import { useMemo } from 'react';
import { CopyButton } from '@insforge/ui';
import { useProjectId } from '#lib/hooks/useMetadata';
import { cn } from '#lib/utils/utils';

interface DTestInstallCliSectionProps {
  className?: string;
}

export function DTestInstallCliSection({ className }: DTestInstallCliSectionProps) {
  const { projectId } = useProjectId();

  const command = useMemo(
    () => `npx @insforge/cli link --project-id ${projectId ?? '<project-id>'}`,
    [projectId]
  );
  const canCopy = Boolean(projectId);

  return (
    <section
      className={cn(
        'flex flex-col gap-3 rounded border border-[var(--alpha-8)] bg-card p-6',
        className
      )}
    >
      <h2 className="text-base font-medium leading-7 text-foreground">Use InsForge with CLI</h2>

      <div className="flex flex-col gap-2 rounded border border-[var(--alpha-8)] bg-semantic-1 p-3">
        <div className="flex items-center justify-between">
          <span className="rounded bg-[var(--alpha-8)] px-2 py-0.5 text-xs font-medium leading-4 text-muted-foreground">
            Command
          </span>
          <CopyButton text={command} showText={false} disabled={!canCopy} className="shrink-0" />
        </div>
        <pre className="m-0 whitespace-pre-wrap break-all font-mono text-sm leading-6 text-foreground">
          {command}
        </pre>
      </div>
    </section>
  );
}
