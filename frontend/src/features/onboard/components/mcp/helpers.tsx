import { ReactElement } from 'react';
export interface MCPAgent {
  id: string;
  displayName: string;
  logo?: ReactElement;
}

import TraeLogo from '@/assets/logos/trae.svg?react';
import CursorLogo from '@/assets/logos/cursor.svg?react';
import ClaudeLogo from '@/assets/logos/claude_code.svg?react';
import WindsurfLogo from '@/assets/logos/windsurf.svg?react';
import ClineLogo from '@/assets/logos/cline.svg?react';
import RooCodeLogo from '@/assets/logos/roo_code.svg';
import QoderLogo from '@/assets/logos/qoder.svg?react';
import CopilotLogo from '@/assets/logos/copilot.svg?react';
import AntigravityLogo from '@/assets/logos/antigravity.svg?react';
import OpenAILogo from '@/assets/logos/openai.svg?react';
import KiroLogo from '@/assets/logos/kiro.svg?react';
import { getBackendUrl } from '@/lib/utils/utils';
// import CodexLogo from '@/assets/logos/openai.svg?react';

export type PlatformType = 'macos-linux' | 'windows';

export const GenerateInstallCommand = (agent: MCPAgent, apiKey: string) => {
  return `npx @insforge/install --client ${agent.id} --env API_KEY=${apiKey} --env API_BASE_URL=${getBackendUrl()}`;
};

export const MCP_AGENTS: MCPAgent[] = [
  {
    id: 'cursor',
    displayName: 'Cursor',
    logo: <CursorLogo className="w-6 h-6" />,
  },
  {
    id: 'claude-code',
    displayName: 'Claude Code',
    logo: <ClaudeLogo className="w-6 h-6" />,
  },
  {
    id: 'trae',
    displayName: 'Trae',
    logo: <TraeLogo className="w-5 h-5" />,
  },
  {
    id: 'cline',
    displayName: 'Cline',
    logo: <ClineLogo className="w-6 h-6 dark:text-white" />,
  },
  {
    id: 'windsurf',
    displayName: 'Windsurf',
    logo: <WindsurfLogo className="w-6 h-6 dark:text-white" />,
  },
  {
    id: 'roocode',
    displayName: 'Roo Code',
    logo: <img src={RooCodeLogo} alt="" className="dark:invert" />,
  },
  {
    id: 'qoder',
    displayName: 'Qoder',
    logo: <QoderLogo className="w-5 h-5 dark:text-white" />,
  },
  {
    id: 'copilot',
    displayName: 'Copilot',
    logo: <CopilotLogo className="w-5 h-5 dark:text-white" />,
  },
  {
    id: 'antigravity',
    displayName: 'Antigravity',
    logo: <AntigravityLogo className="w-5 h-5 dark:text-white" />,
  },
  {
    id: 'codex',
    displayName: 'Codex',
    logo: <OpenAILogo className="w-5 h-5 dark:text-white" />,
  },
  {
    id: 'kiro',
    displayName: 'Kiro',
    logo: <KiroLogo className="w-5 h-5 dark:text-white" />,
  },
  {
    id: 'mcp',
    displayName: 'MCP JSON',
  },
];

// Core MCP server configuration builder
export const createMCPServerConfig = (
  apiKey: string,
  platform: PlatformType,
  apiBaseUrl?: string
) => {
  const env = {
    API_KEY: apiKey,
    API_BASE_URL: apiBaseUrl || window.location.origin,
  };

  if (platform === 'windows') {
    return {
      command: 'cmd',
      args: ['/c', 'npx', '-y', '@insforge/mcp@latest'],
      env,
    };
  } else {
    return {
      command: 'npx',
      args: ['-y', '@insforge/mcp@latest'],
      env,
    };
  }
};

// Full MCP configuration for AI assistants
export const createMCPConfig = (apiKey: string, platform: PlatformType, apiBaseUrl?: string) => {
  return {
    mcpServers: {
      insforge: createMCPServerConfig(apiKey, platform, apiBaseUrl),
    },
  };
};
