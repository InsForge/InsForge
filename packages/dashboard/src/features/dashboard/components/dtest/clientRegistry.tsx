import { type ReactNode } from 'react';
import { Database, Sparkles } from 'lucide-react';
import KeyHorizontalIcon from '../../../../assets/icons/key_horizontal.svg?react';
import ClaudeLogo from '../../../../assets/logos/claude_code.svg?react';
import OpenAILogo from '../../../../assets/logos/openai.svg?react';
import CursorLogo from '../../../../assets/logos/cursor.svg?react';
import CopilotLogo from '../../../../assets/logos/copilot.svg?react';
import OpenCodeLogo from '../../../../assets/logos/opencode.svg?react';
import ClineLogo from '../../../../assets/logos/cline.svg?react';
import AntigravityLogo from '../../../../assets/logos/antigravity.png';

export type ClientId =
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

export interface ClientEntry {
  id: ClientId;
  label: string;
  icon: ReactNode;
  detailIcon: ReactNode;
  kind: ClientKind;
  /** MCP dropdown preselection inside the detail page. Omit for 'other' & direct-connect. */
  mcpAgentId?: string;
}

const iconTile = (node: ReactNode) => (
  <span className="flex h-8 w-8 items-center justify-center">{node}</span>
);

export const CLIENT_ENTRIES: Record<ClientId, ClientEntry> = {
  'claude-code': {
    id: 'claude-code',
    label: 'Claude Code',
    icon: iconTile(<ClaudeLogo className="h-8 w-8" />),
    detailIcon: <ClaudeLogo className="h-8 w-8" />,
    kind: 'agent',
    mcpAgentId: 'claude-code',
  },
  codex: {
    id: 'codex',
    label: 'Codex',
    icon: iconTile(<OpenAILogo className="h-8 w-8 dark:text-white" />),
    detailIcon: <OpenAILogo className="h-8 w-8 dark:text-white" />,
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
    icon: iconTile(<Sparkles className="h-6 w-6 text-foreground" />),
    detailIcon: <Sparkles className="h-8 w-8 text-foreground" />,
    kind: 'agent',
    // Jumps directly to the MCP JSON config (no agent dropdown needed).
    mcpAgentId: 'mcp',
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

export const FEATURED_CLAUDE_CODE_ID: ClientId = 'claude-code';

export const DIRECT_CONNECT_IDS: ClientId[] = ['connection-string', 'api-keys'];
