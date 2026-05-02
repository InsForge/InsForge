import { CopyButton } from '@insforge/ui';
import { useProjectId } from '#lib/hooks/useMetadata';
import { cn } from '#lib/utils/utils';

interface CLISectionV2Props {
  className?: string;
}

export function CLISectionV2({ className }: CLISectionV2Props) {
  const { projectId } = useProjectId();
  const hasProjectId = Boolean(projectId);
  const cliLinkCommand = `npx @insforge/cli link --project-id ${projectId || '<project id>'}`;

  return (
    <div className={cn('flex gap-6', className)}>
      <div className="flex w-[240px] shrink-0 flex-col gap-2">
        <p className="text-sm font-medium leading-6 text-foreground">Link Project</p>
        <p className="text-sm leading-6 text-muted-foreground">
          Run the following command in your terminal
        </p>
      </div>
      <div className="flex flex-1 flex-col gap-2 rounded border border-[var(--alpha-8)] bg-semantic-0 p-3">
        <div className="flex items-center justify-between">
          <div className="flex h-5 items-center rounded bg-[var(--alpha-8)] px-2">
            <span className="text-xs font-medium leading-4 text-muted-foreground">
              terminal command
            </span>
          </div>
          <CopyButton
            text={cliLinkCommand}
            showText={false}
            className="shrink-0"
            disabled={!hasProjectId}
          />
        </div>
        <p className="font-mono text-sm leading-6 text-foreground break-all">{cliLinkCommand}</p>
      </div>
    </div>
  );
}
