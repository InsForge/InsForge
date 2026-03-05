import { CopyButton } from '@insforge/ui';
import { VERIFY_CONNECTION_PROMPT } from '../constants';
import { cn } from '@/lib/utils/utils';

const CLI_INSTALL_COMMAND = 'npx @insforge/cli create';

interface CLISectionProps {
  className?: string;
}

export function CLISection({ className }: CLISectionProps) {
  return (
    <div className={cn('flex flex-col gap-6', className)}>
      <div className="flex flex-col gap-2">
        <div className="flex flex-col">
          <p className="text-sm font-medium leading-6 text-foreground">Step 1 - Install InsForge</p>
          <p className="text-sm leading-6 text-muted-foreground">
            Run the following command in your terminal
          </p>
        </div>
        <div className="flex items-center justify-center gap-2 rounded border border-[var(--alpha-8)] bg-semantic-0 py-3 pl-6 pr-3">
          <div className="flex min-w-0 flex-1 items-center gap-4 font-mono text-sm text-foreground">
            <p className="shrink-0">$</p>
            <p className="min-w-0 flex-1 truncate">{CLI_INSTALL_COMMAND}</p>
          </div>
          <CopyButton
            text={CLI_INSTALL_COMMAND}
            copyText="Copy"
            copiedText="Copied"
            className="h-8 rounded px-3 text-sm font-medium"
          />
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
            <CopyButton text={VERIFY_CONNECTION_PROMPT} showText={false} className="shrink-0" />
          </div>
          <p className="font-mono text-sm leading-6 text-foreground">{VERIFY_CONNECTION_PROMPT}</p>
        </div>
      </div>
    </div>
  );
}
