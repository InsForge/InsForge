// Onboard components
export {
  ConnectDialog,
  getOnboardingSkipped,
  setOnboardingSkipped,
} from './components/ConnectDialog';
export { OnboardingOverlay } from './components/OnboardingOverlay';
export { VideoDemoModal } from './components/VideoDemoModal';
export { MCPSection } from './components/MCPSection';
export { CLISection } from './components/CLISection';
export { APIKeysSection } from './components/APIKeysSection';
export { ConnectionStringSection } from './components/ConnectionStringSection';
export { ShowPasswordButton } from './components/ShowPasswordButton';
export { OnboardingController } from './components/OnboardingController';
// MCP helpers
export { CursorDeeplinkGenerator } from './components/mcp/CursorDeeplinkGenerator';
export type { MCPAgent, PlatformType } from './components/mcp/helpers';
export { MCP_AGENTS, createMCPConfig, createMCPServerConfig } from './components/mcp/helpers';
