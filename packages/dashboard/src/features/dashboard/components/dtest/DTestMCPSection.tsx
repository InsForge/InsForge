import { useCallback, useMemo } from 'react';
import { CopyButton } from '@insforge/ui';
import {
  MCP_AGENTS,
  GenerateInstallCommand,
  createMCPConfig,
  createMCPServerConfig,
  type MCPAgent,
  type PlatformType,
} from '../connect/mcp/helpers';
import { MCP_VERIFY_CONNECTION_PROMPT } from '../connect/constants';
import { QuickStartPromptCard } from './QuickStartPromptCard';
import { cn } from '../../../../lib/utils/utils';
import { trackPostHog, getFeatureFlag } from '../../../../lib/analytics/posthog';

function buildMcpDeeplink(agentId: string, apiKey: string, appUrl: string): string | null {
  const config = createMCPServerConfig(apiKey, 'macos-linux' as PlatformType, appUrl);
  const configString = JSON.stringify(config);
  if (agentId === 'cursor') {
    const base64Config = btoa(configString);
    return `cursor://anysphere.cursor-deeplink/mcp/install?name=insforge&config=${encodeURIComponent(base64Config)}`;
  }
  if (agentId === 'qoder') {
    const base64Config = btoa(encodeURIComponent(configString));
    return `qoder://aicoding.aicoding-deeplink/mcp/add?name=insforge&config=${encodeURIComponent(base64Config)}`;
  }
  return null;
}

interface DTestMCPSectionProps {
  apiKey: string;
  appUrl: string;
  isLoading?: boolean;
  className?: string;
  /** Pick the agent whose install command (or MCP JSON for id='mcp') is shown. Falls back to MCP_AGENTS[0]. */
  agentId?: string;
}

function buildQuickStartPrompt(agent: MCPAgent, installBody: string) {
  if (agent.id === 'mcp') {
    return `I'm using InsForge as my backend platform. Please add the following MCP configuration to enable the InsForge MCP server:\n\n${installBody}\n\nThen ${MCP_VERIFY_CONNECTION_PROMPT.replace(/^I'm using InsForge as my backend platform, /i, '')}`;
  }
  return `I'm using InsForge as my backend platform. Please run this command to install the InsForge MCP server:\n\n${installBody}\n\nThen ${MCP_VERIFY_CONNECTION_PROMPT.replace(/^I'm using InsForge as my backend platform, /i, '')}`;
}

export function DTestMCPSection({
  apiKey,
  appUrl,
  isLoading = false,
  className,
  agentId,
}: DTestMCPSectionProps) {
  const agent = useMemo(() => MCP_AGENTS.find((a) => a.id === agentId) ?? MCP_AGENTS[0], [agentId]);

  const isMcpJson = agent.id === 'mcp';
  const deeplink = useMemo(
    () => (apiKey ? buildMcpDeeplink(agent.id, apiKey, appUrl) : null),
    [agent.id, apiKey, appUrl]
  );

  const installBody = useMemo(() => {
    if (isMcpJson) {
      return JSON.stringify(createMCPConfig(apiKey, 'macos-linux', appUrl), null, 2);
    }
    return GenerateInstallCommand(agent, apiKey);
  }, [isMcpJson, agent, apiKey, appUrl]);

  const quickStartPrompt = useMemo(
    () => buildQuickStartPrompt(agent, installBody),
    [agent, installBody]
  );

  if (deeplink) {
    return (
      <div className={cn('flex flex-col gap-3', className)}>
        <section className="flex flex-col rounded border border-[var(--alpha-8)] bg-card p-6">
          <Step number={1} title="Install InsForge MCP" description="Install in one click">
            <InstallDeeplinkButton agent={agent} deeplink={deeplink} />
          </Step>
          <Step
            number={2}
            title="Verify Connection"
            description="Send the prompt below to your AI coding agent to verify the connection."
            isLast
          >
            <PastePromptButton agent={agent} prompt={MCP_VERIFY_CONNECTION_PROMPT} />
          </Step>
        </section>
      </div>
    );
  }

  return (
    <div className={cn('flex flex-col gap-3', className)}>
      <QuickStartPromptCard
        subtitle={`Paste this into ${agent.displayName} to setup InsForge MCP`}
        prompt={quickStartPrompt}
      />

      {/* Step by Step card */}
      <section className="flex flex-col gap-6 rounded border border-[var(--alpha-8)] bg-card p-6">
        <span className="w-fit rounded bg-[var(--alpha-8)] px-1.5 py-0.5 text-xs font-medium leading-4 text-[rgb(var(--warning))]">
          Step by Step
        </span>

        <div className="flex flex-col">
          <Step
            number={1}
            title={isMcpJson ? 'Add MCP Configuration' : 'Install InsForge MCP'}
            description={
              isMcpJson
                ? 'Add this configuration to your MCP settings.'
                : 'Run the following command in terminal to install InsForge MCP Server'
            }
          >
            <CodeBlock
              badge={isMcpJson ? 'MCP JSON' : 'terminal command'}
              code={installBody}
              isLoading={isLoading}
              mono
              scroll={isMcpJson}
            />
          </Step>

          <Step
            number={2}
            title="Verify Connection"
            description="Send the prompt below to your AI coding agent to verify the connection."
            isLast
          >
            <CodeBlock badge="prompt" code={MCP_VERIFY_CONNECTION_PROMPT} mono />
          </Step>
        </div>
      </section>
    </div>
  );
}

interface InstallDeeplinkButtonProps {
  agent: MCPAgent;
  deeplink: string;
}

function InstallDeeplinkButton({ agent, deeplink }: InstallDeeplinkButtonProps) {
  const handleClick = useCallback(() => {
    trackPostHog('onboarding_action_taken', {
      action_type: 'install mcp',
      experiment_variant: getFeatureFlag('onboarding-method-experiment'),
      method: 'terminal',
      agent_id: agent.id,
      install_type: 'deeplink',
    });
    window.open(deeplink, '_blank');
  }, [agent.id, deeplink]);

  return (
    <WhiteActionButton
      onClick={handleClick}
      agent={agent}
      label={`Install to ${agent.displayName}`}
    />
  );
}

interface PastePromptButtonProps {
  agent: MCPAgent;
  prompt: string;
}

function PastePromptButton({ agent, prompt }: PastePromptButtonProps) {
  const handleClick = useCallback(() => {
    trackPostHog('onboarding_action_taken', {
      action_type: 'verify mcp',
      experiment_variant: getFeatureFlag('onboarding-method-experiment'),
      method: 'clipboard',
      agent_id: agent.id,
      install_type: 'deeplink',
    });
    void navigator.clipboard?.writeText(prompt);
  }, [agent.id, prompt]);

  return (
    <WhiteActionButton
      onClick={handleClick}
      agent={agent}
      label={`Paste Prompt to ${agent.displayName}`}
    />
  );
}

interface WhiteActionButtonProps {
  onClick: () => void;
  agent: MCPAgent;
  label: string;
}

function WhiteActionButton({ onClick, agent, label }: WhiteActionButtonProps) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="flex h-8 w-fit items-center gap-1 rounded bg-white px-1.5 text-sm font-medium text-black transition-opacity hover:opacity-90"
    >
      {agent.logo && <div className="flex h-5 w-5 items-center justify-center">{agent.logo}</div>}
      <span className="px-1">{label}</span>
    </button>
  );
}

interface StepProps {
  number: number;
  title: string;
  description: string;
  isLast?: boolean;
  children: React.ReactNode;
}

function Step({ number, title, description, isLast = false, children }: StepProps) {
  return (
    <div className="flex w-full gap-3">
      {/* Indicator column */}
      <div className="flex shrink-0 flex-col items-center pt-0.5">
        <div className="flex h-5 w-5 items-center justify-center rounded-full bg-[var(--alpha-8)] text-xs font-medium leading-4 text-foreground">
          {number}
        </div>
        {!isLast && <div className="mt-1 w-px flex-1 bg-[var(--alpha-8)]" />}
      </div>

      {/* Content */}
      <div className={cn('flex min-w-0 flex-1 flex-col gap-3', !isLast && 'pb-6')}>
        <div className="flex flex-col gap-2">
          <p className="text-sm font-medium leading-6 text-foreground">{title}</p>
          <p className="text-sm leading-5 text-muted-foreground">{description}</p>
        </div>
        {children}
      </div>
    </div>
  );
}

interface CodeBlockProps {
  badge: string;
  code: string;
  isLoading?: boolean;
  mono?: boolean;
  scroll?: boolean;
}

function CodeBlock({
  badge,
  code,
  isLoading = false,
  mono = true,
  scroll = false,
}: CodeBlockProps) {
  return (
    <div
      className={cn(
        'flex flex-col gap-2 rounded border border-[var(--alpha-8)] bg-semantic-1 p-3',
        isLoading && 'animate-pulse'
      )}
    >
      <div className="flex items-center justify-between">
        <span className="rounded bg-[var(--alpha-8)] px-2 py-0.5 text-xs font-medium leading-4 text-muted-foreground">
          {badge}
        </span>
        <CopyButton text={code} showText={false} className="shrink-0" />
      </div>
      <pre
        className={cn(
          'm-0 whitespace-pre-wrap break-all text-sm leading-6 text-foreground',
          mono && 'font-mono',
          scroll && 'max-h-[320px] overflow-auto'
        )}
      >
        {code}
      </pre>
    </div>
  );
}
