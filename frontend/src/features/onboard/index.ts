// Onboard components
export { McpConnectionStatus } from './components/McpConnectionStatus';
export {
  OnboardingModal,
  getOnboardingSkipped,
  setOnboardingSkipped,
} from './components/OnboardingModal';
export { VideoDemoModal } from './components/VideoDemoModal';

// MCP helpers
export { CursorDeeplinkGenerator } from './components/mcp/CursorDeeplinkGenerator';
export type { MCPAgent, PlatformType } from './components/mcp/helpers';
export { MCP_AGENTS, createMCPConfig, createMCPServerConfig } from './components/mcp/helpers';
