import { useState } from 'react';
import {
  Button,
  CodeBlock,
  Dialog,
  DialogBody,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@insforge/ui';
import { useDashboardHost } from '#lib/config/DashboardHostContext';
import { useProjectId } from '#lib/hooks/useMetadata';
import { useApifyConnection } from '#features/datasource/hooks/useDatasource';
import type { ConnectorDef } from '#features/datasource/connectors';
import { ApifyDisconnectDialog } from './ApifyDisconnectDialog';

export function ConnectorCard({ connector }: { connector: ConnectorDef }) {
  const [promptOpen, setPromptOpen] = useState(false);
  const [disconnectOpen, setDisconnectOpen] = useState(false);
  const { projectId } = useProjectId();
  const { onConnectApify } = useDashboardHost();
  const conn = useApifyConnection();
  const connection = conn.data ?? null;

  return (
    <>
      <div
        role="button"
        tabIndex={0}
        onClick={() => setPromptOpen(true)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            setPromptOpen(true);
          }
        }}
        className="flex cursor-pointer flex-col gap-3 rounded border border-[var(--alpha-8)] bg-card p-6 transition-colors hover:border-[var(--alpha-16)] hover:bg-[var(--alpha-4)]"
      >
        <div className="flex items-center justify-between">
          <span className="text-sm font-medium text-foreground">{connector.name}</span>
          <span className="rounded bg-[var(--alpha-8)] px-2 py-0.5 text-xs text-muted-foreground">
            {connector.auth === 'oauth2' ? 'OAuth2' : 'API Key'}
          </span>
        </div>
        <p className="text-sm text-muted-foreground">{connector.tagline}</p>
        {connection ? (
          <Button
            variant="secondary"
            onClick={(e) => {
              e.stopPropagation();
              setDisconnectOpen(true);
            }}
            className="self-start"
          >
            Disconnect
          </Button>
        ) : (
          <Button
            variant="primary"
            disabled={!onConnectApify || !projectId}
            onClick={(e) => {
              e.stopPropagation();
              if (projectId) {
                onConnectApify?.(projectId);
              }
            }}
            className="self-start"
          >
            Connect
          </Button>
        )}
      </div>

      <Dialog open={promptOpen} onOpenChange={setPromptOpen}>
        <DialogContent className="w-[560px] max-w-[560px]">
          <DialogHeader>
            <DialogTitle>{connector.name}</DialogTitle>
            <DialogDescription className="sr-only">{connector.tagline}</DialogDescription>
          </DialogHeader>
          <DialogBody>
            <CodeBlock code={connector.examplePrompt} label="prompt" />
          </DialogBody>
        </DialogContent>
      </Dialog>

      <ApifyDisconnectDialog open={disconnectOpen} onClose={() => setDisconnectOpen(false)} />
    </>
  );
}
