import { MCP_SETUP_BASE_URL } from './mcp/helpers';
import DiscordIcon from '@/assets/logos/discord.svg?react';

interface HelpSectionProps {
  agentSlug?: string;
}

export function HelpSection({ agentSlug }: HelpSectionProps) {
  const guideUrl = agentSlug ? `${MCP_SETUP_BASE_URL}#${agentSlug}` : MCP_SETUP_BASE_URL;

  return (
    <div className="px-4 py-3 rounded-lg bg-[#333333] inline-flex items-center gap-1">
      <span className="text-gray-500 dark:text-neutral-400 text-sm leading-6">Need help? View</span>
      <a
        href={guideUrl}
        target="_blank"
        rel="noopener noreferrer"
        className="text-sm leading-6 font-medium text-white"
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
