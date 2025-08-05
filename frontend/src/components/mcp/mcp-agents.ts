import CursorLogoIcon from '@/assets/icons/cursor_logo.svg';
import ClaudeLogoIcon from '@/assets/icons/claude_code_logo.svg';
import WindsurfLogoIcon from '@/assets/icons/windsurf_logo.svg';
import ClineLogoIcon from '@/assets/icons/cline_logo.svg';
import RooLogoIcon from '@/assets/icons/roo_code_logo.svg';

export interface MCPAgent {
  id: string;
  displayName: string;
  logo?: string;
  description?: string;
}

export type PlatformType = 'macos-linux' | 'windows';

// Helper to get the API base URL
const apiBaseUrl = import.meta.env.VITE_API_BASE_URL;

export const GenerateInstallCommand = (agent: MCPAgent, apiKey: string) => {
  return `npx @insforge/install --client ${agent.id} --env API_KEY=${apiKey} --env API_BASE_URL=${apiBaseUrl}`;
};

export const MCP_AGENTS: MCPAgent[] = [
  {
    id: 'cursor',
    displayName: 'Cursor',
    logo: CursorLogoIcon,
    description: 'AI-powered code editor with built-in MCP support',
  },
  {
    id: 'claude_code',
    displayName: 'Claude Code',
    logo: ClaudeLogoIcon,
    description: "Anthropic's Claude with MCP integration",
  },
  {
    id: 'windsurf',
    displayName: 'Windsurf',
    logo: WindsurfLogoIcon,
    description: 'Next-generation AI development environment',
  },
  {
    id: 'cline',
    displayName: 'Cline',
    logo: ClineLogoIcon,
    description: 'Intelligent coding assistant with MCP support',
  },
  {
    id: 'roo',
    displayName: 'Roo Code',
    logo: RooLogoIcon,
    description: 'Smart code completion and assistance tool',
  },
  {
    id: 'mcp',
    displayName: 'MCP JSON',
    description: 'Direct MCP configuration for manual setup',
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
    API_BASE_URL: apiBaseUrl || import.meta.env.VITE_API_BASE_URL,
  };

  if (platform === 'windows') {
    return {
      command: 'cmd',
      args: ['/c', 'npx', '-y', '@insforge/insforge-mcp@latest'],
      env,
    };
  } else {
    return {
      command: 'npx',
      args: ['-y', '@insforge/insforge-mcp@latest'],
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
