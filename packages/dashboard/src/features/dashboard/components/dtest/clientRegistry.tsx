import { type ReactNode } from 'react';
import { Database } from 'lucide-react';
import KeyHorizontalIcon from '../../../../assets/icons/key_horizontal.svg?react';
import ClaudeLogo from '../../../../assets/logos/claude_code.png';
import CodexLogo from '../../../../assets/logos/codex.svg?react';
import CursorLogo from '../../../../assets/logos/cursor.svg?react';
import CopilotLogo from '../../../../assets/logos/copilot.svg?react';
import OpenCodeLogo from '../../../../assets/logos/opencode.svg?react';
import OpenClawLogo from '../../../../assets/logos/openclaw.svg?react';
import ClineLogo from '../../../../assets/logos/cline.svg?react';
import AntigravityLogo from '../../../../assets/logos/antigravity.png';
import OtherAgentsLogo from '../../../../assets/logos/other_agents.svg?react';

export type ClientId =
  | 'openclaw'
  | 'claude-code'
  | 'codex'
  | 'antigravity'
  | 'cursor'
  | 'opencode'
  | 'copilot'
  | 'cline'
  | 'other'
  | 'connection-string'
  | 'api-keys';

export type ClientKind = 'agent' | 'direct-connect';

export type AgentTab = 'cli' | 'mcp';

export interface ClientEntry {
  id: ClientId;
  label: string;
  icon: ReactNode;
  detailIcon: ReactNode;
  kind: ClientKind;
  /** MCP detail preselection. Use 'mcp' for "Other Agents"; omit for direct-connect. */
  mcpAgentId?: string;
  /**
   * Tabs available on the detail page for `kind: 'agent'`. Omit = both CLI and
   * MCP. Use `['cli']` for OpenClaw (install flow only) and `['mcp']` for
   * "Other Agents" (drops straight into the MCP JSON config).
   */
  tabs?: ReadonlyArray<AgentTab>;
}

const iconTile = (node: ReactNode) => (
  <span className="flex h-8 w-8 items-center justify-center">{node}</span>
);

export const CLIENT_ENTRIES: Record<ClientId, ClientEntry> = {
  openclaw: {
    id: 'openclaw',
    label: 'OpenClaw',
    icon: iconTile(<OpenClawLogo className="h-8 w-8" />),
    detailIcon: <OpenClawLogo className="h-8 w-8" />,
    kind: 'agent',
    mcpAgentId: 'openclaw',
    tabs: ['cli'],
  },
  'claude-code': {
    id: 'claude-code',
    label: 'Claude Code',
    icon: iconTile(<img src={ClaudeLogo} alt="Claude Code" className="h-8 w-8 object-contain" />),
    detailIcon: <img src={ClaudeLogo} alt="Claude Code" className="h-8 w-8 object-contain" />,
    kind: 'agent',
    mcpAgentId: 'claude-code',
  },
  codex: {
    id: 'codex',
    label: 'Codex',
    icon: iconTile(<CodexLogo className="h-8 w-8" />),
    detailIcon: <CodexLogo className="h-8 w-8" />,
    kind: 'agent',
    mcpAgentId: 'codex',
  },
  antigravity: {
    id: 'antigravity',
    label: 'Antigravity',
    icon: iconTile(
      <img src={AntigravityLogo} alt="Antigravity" className="h-8 w-8 object-contain" />
    ),
    detailIcon: <img src={AntigravityLogo} alt="Antigravity" className="h-8 w-8 object-contain" />,
    kind: 'agent',
    mcpAgentId: 'antigravity',
  },
  cursor: {
    id: 'cursor',
    label: 'Cursor',
    icon: iconTile(<CursorLogo className="h-8 w-8" />),
    detailIcon: <CursorLogo className="h-8 w-8" />,
    kind: 'agent',
    mcpAgentId: 'cursor',
  },
  opencode: {
    id: 'opencode',
    label: 'OpenCode',
    icon: iconTile(<OpenCodeLogo className="h-8 w-8 dark:text-white" />),
    detailIcon: <OpenCodeLogo className="h-8 w-8 dark:text-white" />,
    kind: 'agent',
    mcpAgentId: 'opencode',
  },
  copilot: {
    id: 'copilot',
    label: 'Copilot',
    icon: iconTile(<CopilotLogo className="h-8 w-8 dark:text-white" />),
    detailIcon: <CopilotLogo className="h-8 w-8 dark:text-white" />,
    kind: 'agent',
    mcpAgentId: 'copilot',
  },
  cline: {
    id: 'cline',
    label: 'Cline',
    icon: iconTile(<ClineLogo className="h-8 w-8 dark:text-white" />),
    detailIcon: <ClineLogo className="h-8 w-8 dark:text-white" />,
    kind: 'agent',
    mcpAgentId: 'cline',
  },
  other: {
    id: 'other',
    label: 'Other Agents',
    icon: iconTile(<OtherAgentsLogo className="h-8 w-8 text-foreground" />),
    detailIcon: <OtherAgentsLogo className="h-8 w-8 text-foreground" />,
    kind: 'agent',
    // Jumps directly to the MCP JSON config (no agent dropdown needed).
    mcpAgentId: 'mcp',
    tabs: ['mcp'],
  },
  'connection-string': {
    id: 'connection-string',
    label: 'Connection String',
    icon: iconTile(<Database className="h-6 w-6 text-foreground" />),
    detailIcon: <Database className="h-8 w-8 text-foreground" />,
    kind: 'direct-connect',
  },
  'api-keys': {
    id: 'api-keys',
    label: 'API Keys',
    icon: iconTile(<KeyHorizontalIcon className="h-6 w-6 text-foreground" />),
    detailIcon: <KeyHorizontalIcon className="h-8 w-8 text-foreground" />,
    kind: 'direct-connect',
  },
};

/** Ordered ids for the "Install in Coding Agent" grid (displayed row-by-row, 2 per row). */
export const CODING_AGENT_GRID_IDS: ClientId[] = [
  'claude-code',
  'codex',
  'antigravity',
  'cursor',
  'opencode',
  'copilot',
  'cline',
  'other',
];

export const FEATURED_OPENCLAW_ID: ClientId = 'openclaw';

export const DIRECT_CONNECT_IDS: ClientId[] = ['connection-string', 'api-keys'];
