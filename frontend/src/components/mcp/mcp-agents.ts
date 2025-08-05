import CursorLogoIcon from '@/assets/icons/cursor_logo.svg';
import ClaudeLogoIcon from '@/assets/icons/claude_code_logo.svg';
import WindsurfLogoIcon from '@/assets/icons/windsurf_logo.svg';
import ClineLogoIcon from '@/assets/icons/cline_logo.svg';
import RooLogoIcon from '@/assets/icons/roo_code_logo.svg';

export interface MCPAgent {
  id: string;
  displayName: string;
  installCommand?: () => string;
  logo?: string;
  description?: string;
}

export type PlatformType = 'macos-linux' | 'windows';

// Helper to get the API base URL
const getApiBaseUrl = () => import.meta.env.VITE_API_BASE_URL || 'http://localhost:7130';

export const MCP_AGENTS: MCPAgent[] = [
  {
    id: 'cursor',
    displayName: 'Cursor',
    installCommand: () =>
      `npx @insforge/install --client cursor --env API_KEY=YOUR_API_KEY --env API_BASE_URL=${getApiBaseUrl()}`,
    logo: CursorLogoIcon,
    description: 'AI-powered code editor with built-in MCP support',
  },
  {
    id: 'claude',
    displayName: 'Claude Code',
    installCommand: () =>
      `npx @insforge/install --client claude-code --env API_KEY=YOUR_API_KEY --env API_BASE_URL=${getApiBaseUrl()}`,
    logo: ClaudeLogoIcon,
    description: "Anthropic's Claude with MCP integration",
  },
  {
    id: 'windsurf',
    displayName: 'Windsurf',
    installCommand: () =>
      `npx @insforge/install --client windsurf --env API_KEY=YOUR_API_KEY --env API_BASE_URL=${getApiBaseUrl()}`,
    logo: WindsurfLogoIcon,
    description: 'Next-generation AI development environment',
  },
  {
    id: 'cline',
    displayName: 'Cline',
    installCommand: () =>
      `npx @insforge/install --client cline --env API_KEY=YOUR_API_KEY --env API_BASE_URL=${getApiBaseUrl()}`,
    logo: ClineLogoIcon,
    description: 'Intelligent coding assistant with MCP support',
  },
  {
    id: 'roo',
    displayName: 'Roo Code',
    installCommand: () =>
      `npx @insforge/install --client roocode --env API_KEY=YOUR_API_KEY --env API_BASE_URL=${getApiBaseUrl()}`,
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
    API_KEY: apiKey || 'your-api-key-here',
    API_BASE_URL: apiBaseUrl || import.meta.env.VITE_API_BASE_URL || 'http://localhost:7130',
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
