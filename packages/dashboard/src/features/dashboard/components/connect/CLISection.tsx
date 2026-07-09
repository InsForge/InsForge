import { useState } from 'react';
import { ChevronDown } from 'lucide-react';
import {
  CopyButton,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  cn,
} from '@insforge/ui';
import { CLI_VERIFY_CONNECTION_PROMPT } from './constants';
import { useProjectId } from '#lib/hooks/useMetadata';
import { MCP_AGENTS, type MCPAgent } from './mcp/helpers';

interface CLISectionProps {
  className?: string;
}

export function CLISection({ className }: CLISectionProps) {
  const { projectId } = useProjectId();
  const [selectedProvider, setSelectedProvider] = useState<MCPAgent>(MCP_AGENTS[0]);

  const cliLinkCommand = `npx @insforge/cli link --project-id ${projectId || '<project id>'}`;
  const cliConnectCommand = `npx @insforge/cli connect ${selectedProvider.id}`;
  const cliDisconnectCommand = `npx @insforge/cli disconnect ${selectedProvider.id}`;

  return (
    <div className={cn('flex flex-col gap-6', className)}>
      {/* Step 1 - Link Project */}
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

      {/* Step 2 - Connect MCP Provider */}
      <div className="flex flex-col gap-3">
        <div className="flex flex-col">
          <p className="text-sm font-medium leading-6 text-foreground">
            Step 2 - Connect MCP Provider
          </p>
          <p className="text-sm leading-6 text-muted-foreground">
            Select your AI coding agent and run the connect command to wire up InsForge MCP
          </p>
        </div>
        <div className="flex flex-col gap-3">
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button className="flex w-40 cursor-pointer items-center justify-between rounded border border-[var(--alpha-8)] bg-semantic-0 px-2 py-1 transition-colors hover:bg-[var(--alpha-4)]">
                <span className="text-sm font-medium text-foreground">
                  {selectedProvider.displayName}
                </span>
                <ChevronDown className="h-5 w-5 text-muted-foreground" />
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start" className="w-40 p-0">
              {MCP_AGENTS.map((provider) => (
                <DropdownMenuItem
                  key={provider.id}
                  onSelect={() => setSelectedProvider(provider)}
                  className="cursor-pointer"
                >
                  <span className="font-medium">{provider.displayName}</span>
                </DropdownMenuItem>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>

          <div className="flex flex-col gap-2 rounded border border-[var(--alpha-8)] bg-semantic-0 p-3">
            <div className="flex items-center justify-between">
              <div className="flex h-5 items-center rounded bg-[var(--alpha-8)] px-2">
                <span className="text-xs font-medium leading-4 text-muted-foreground">Connect</span>
              </div>
              <CopyButton text={cliConnectCommand} showText={false} className="shrink-0" />
            </div>
            <p className="font-mono text-sm leading-6 text-foreground break-all">
              {cliConnectCommand}
            </p>
          </div>

          <div className="flex flex-col gap-2 rounded border border-[var(--alpha-8)] bg-semantic-0 p-3">
            <div className="flex items-center justify-between">
              <div className="flex h-5 items-center rounded bg-[var(--alpha-8)] px-2">
                <span className="text-xs font-medium leading-4 text-muted-foreground">
                  Disconnect
                </span>
              </div>
              <CopyButton text={cliDisconnectCommand} showText={false} className="shrink-0" />
            </div>
            <p className="font-mono text-sm leading-6 text-foreground break-all">
              {cliDisconnectCommand}
            </p>
          </div>
        </div>
      </div>

      {/* Step 3 - Verify Connection */}
      <div className="flex flex-col gap-3">
        <div className="flex flex-col">
          <p className="text-sm font-medium leading-6 text-foreground">
            Step 3 - Verify Connection
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
