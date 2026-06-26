import { useState } from 'react';
import { Button, CodeBlock } from '@insforge/ui';
import { useDashboardHost } from '#lib/config/DashboardHostContext';
import { useProjectId } from '#lib/hooks/useMetadata';
import { useApifyConnection } from '#features/datasource/hooks/useDatasource';
import type { ConnectorDef } from '#features/datasource/connectors';
import { ApifyDisconnectDialog } from './ApifyDisconnectDialog';

export function ConnectorCard({ connector }: { connector: ConnectorDef }) {
  const [disconnectOpen, setDisconnectOpen] = useState(false);
  const { projectId } = useProjectId();
  const { onConnectApify } = useDashboardHost();
  const conn = useApifyConnection();
  const connection = conn.data ?? null;

  return (
    <>
      <div className="flex flex-col gap-3 rounded border border-[var(--alpha-8)] bg-card p-6">
        <div className="flex items-center justify-between">
          <span className="text-sm font-medium text-foreground">{connector.name}</span>
          <span className="rounded bg-[var(--alpha-8)] px-2 py-0.5 text-xs text-muted-foreground">
            {connector.auth === 'oauth2' ? 'OAuth2' : 'API Key'}
          </span>
        </div>
        <p className="text-sm text-muted-foreground">{connector.tagline}</p>

        {/* Prompt shown inline so users can copy it without an extra click. */}
        <CodeBlock code={connector.examplePrompt} label="prompt" />

        {conn.isError ? (
          // A non-404 lookup failure means the connection state is unknown, so
          // don't render a misleading Connect button that would start OAuth.
          <p className="text-sm text-muted-foreground">Connection status unavailable.</p>
        ) : connection ? (
          <Button
            variant="secondary"
            onClick={() => setDisconnectOpen(true)}
            className="self-start"
          >
            Disconnect
          </Button>
        ) : (
          <Button
            variant="primary"
            disabled={!onConnectApify || !projectId || conn.isLoading}
            onClick={() => projectId && onConnectApify?.(projectId)}
            className="self-start"
          >
            Connect
          </Button>
        )}
      </div>

      <ApifyDisconnectDialog open={disconnectOpen} onClose={() => setDisconnectOpen(false)} />
    </>
  );
}
