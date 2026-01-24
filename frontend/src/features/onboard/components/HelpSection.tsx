import { MCP_SETUP_BASE_URL, EXTENSION_DOCS_URL } from './mcp/helpers';
import DiscordIcon from '@/assets/logos/discord.svg?react';
import { cn } from '@/lib/utils/utils';
import type { InstallMethod } from './InstallMethodTabs';

interface HelpSectionProps {
  agentSlug?: string;
  installMethod?: InstallMethod;
  className?: string;
}

export function HelpSection({ agentSlug, installMethod, className }: HelpSectionProps) {
  const guideUrl =
    installMethod === 'extension'
      ? EXTENSION_DOCS_URL
      : agentSlug
        ? `${MCP_SETUP_BASE_URL}#${agentSlug}`
        : MCP_SETUP_BASE_URL;

  return (
    <div className={cn('inline-flex items-center gap-1', className)}>
      <span className="text-gray-500 dark:text-neutral-400 text-sm leading-6">Need help? View</span>
      <a
        href={guideUrl}
        target="_blank"
        rel="noopener noreferrer"
        className="text-sm leading-6 font-medium text-black dark:text-white"
      >
        Step by Step Guide
      </a>
      <span className="text-gray-500 dark:text-neutral-400 text-sm leading-6">or join our</span>
      <a
        href="https://discord.gg/DvBtaEc9Jz"
        target="_blank"
        rel="noopener noreferrer"
        className="inline-flex items-center gap-1 mx-1"
      >
        <DiscordIcon className="w-5 h-5 text-indigo-500 dark:text-indigo-400" />
        <span className="text-indigo-500 dark:text-indigo-400 text-sm leading-6 font-medium">
          Discord
        </span>
      </a>
      <span className="text-gray-500 dark:text-neutral-400 text-sm leading-6">
        for live support
      </span>
    </div>
  );
}
