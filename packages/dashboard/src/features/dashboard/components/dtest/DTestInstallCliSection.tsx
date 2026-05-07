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
      <div className="flex items-center justify-between">
        <h2 className="text-base font-medium leading-7 text-foreground">Use InsForge with CLI</h2>
        <CopyButton text={command} showText={false} disabled={!canCopy} className="shrink-0" />
      </div>

      <div className="rounded border border-[var(--alpha-8)] bg-semantic-1 px-3 py-2">
        <pre className="m-0 overflow-x-auto whitespace-nowrap font-mono text-sm leading-6 text-foreground">
          <span className="select-none text-muted-foreground">$ </span>
          {command}
        </pre>
      </div>
    </section>
  );
}
