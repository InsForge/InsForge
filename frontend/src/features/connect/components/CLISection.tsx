import { CopyButton } from '@insforge/ui';
import { CLI_VERIFY_CONNECTION_PROMPT } from '../constants';
import { useProjectId } from '@/lib/hooks/useMetadata';
import { cn } from '@/lib/utils/utils';

interface CLISectionProps {
  className?: string;
}

export function CLISection({ className }: CLISectionProps) {
  const { projectId } = useProjectId();
  const cliLinkCommand = `npx @insforge/cli link --project-id ${projectId || '<project id>'}`;

  return (
    <div className={cn('flex flex-col gap-6', className)}>
      <div className="flex flex-col gap-2">
        <div className="flex flex-col">
          <p className="text-sm font-medium leading-6 text-foreground">Step 1 - Link Project</p>
          <p className="text-sm leading-6 text-muted-foreground">
            Run the following command in your terminal
          </p>
        </div>
        <div className="flex flex-col gap-2 rounded border border-[var(--alpha-8)] bg-semantic-0 p-3">
          <div className="flex items-center justify-between">
            <div className="flex h-5 items-center rounded bg-[var(--alpha-8)] px-2">
              <span className="text-xs font-medium leading-4 text-muted-foreground">
                Terminal Command
              </span>
            </div>
            <CopyButton text={cliLinkCommand} showText={false} className="shrink-0" />
          </div>
          <p className="font-mono text-sm leading-6 text-foreground break-all">{cliLinkCommand}</p>
        </div>
      </div>

      <div className="flex flex-col gap-3">
        <div className="flex flex-col">
          <p className="text-sm font-medium leading-6 text-foreground">
            Step 2 - Verify Connection
          </p>
          <p className="text-sm leading-6 text-muted-foreground">
            Send the prompt below to your AI coding agent to verify the connection.
          </p>
        </div>
        <div className="flex flex-col gap-2 rounded border border-[var(--alpha-8)] bg-semantic-0 p-3">
          <div className="flex items-center justify-between">
            <div className="flex h-5 items-center rounded bg-[var(--alpha-8)] px-2">
              <span className="text-xs font-medium leading-4 text-muted-foreground">prompt</span>
            </div>
            <CopyButton text={CLI_VERIFY_CONNECTION_PROMPT} showText={false} className="shrink-0" />
          </div>
          <p className="font-mono text-sm leading-6 text-foreground">
            {CLI_VERIFY_CONNECTION_PROMPT}
          </p>
        </div>
      </div>
    </div>
  );
}
