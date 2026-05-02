import { useState } from 'react';
import { KeyRound, Trash2 } from 'lucide-react';
import { Button, ConfirmDialog, CopyButton, Input } from '@insforge/ui';
import type { S3AccessKeySchema } from '@insforge/shared-schemas';
import { useS3AccessKeys, useS3GatewayConfig } from '#features/storage/hooks/useS3AccessKeys';
import { S3AccessKeyCreateDialog } from './S3AccessKeyCreateDialog';

/** Formats an ISO timestamp as "N minutes/hours/days ago", or "—" when null. */
function formatRelative(iso: string | null): string {
  if (!iso) {
    return '—';
  }
  const then = Date.parse(iso);
  if (Number.isNaN(then)) {
    return '—';
  }
  const diffMs = Date.now() - then;
  if (diffMs < 0) {
    return new Date(then).toLocaleString();
  }
  const sec = Math.floor(diffMs / 1000);
  if (sec < 60) {
    return `${sec}s ago`;
  }
  const min = Math.floor(sec / 60);
  if (min < 60) {
    return `${min}m ago`;
  }
  const hr = Math.floor(min / 60);
  if (hr < 48) {
    return `${hr}h ago`;
  }
  const day = Math.floor(hr / 24);
  if (day < 30) {
    return `${day}d ago`;
  }
  return new Date(then).toLocaleDateString();
}

interface SectionProps {
  title: string;
  description?: string;
  children: React.ReactNode;
}

function Section({ title, description, children }: SectionProps) {
  return (
    <div className="flex flex-col gap-3">
      <div>
        <h3 className="text-sm font-medium text-foreground">{title}</h3>
        {description && (
          <p className="pt-1 text-[13px] leading-[18px] text-muted-foreground">{description}</p>
        )}
      </div>
      {children}
    </div>
  );
}

/**
 * Right-pane content for the "S3 Compatible API" tab in Storage Settings.
 * Shows the gateway endpoint + region and lets admins manage access keys
 * used by SigV4-signing clients (aws CLI, AWS SDKs, rclone, etc.).
 */
export function S3SettingsPanel() {
  const { keys, isLoading, error, createAccessKey, isCreating, deleteAccessKey, isDeleting } =
    useS3AccessKeys();
  const gatewayConfigQuery = useS3GatewayConfig();
  const endpoint = gatewayConfigQuery.data?.endpoint ?? '';
  const region = gatewayConfigQuery.data?.region ?? '';

  const [createOpen, setCreateOpen] = useState(false);
  const [pendingDelete, setPendingDelete] = useState<S3AccessKeySchema | null>(null);

  return (
    <div className="flex flex-col gap-8 p-6">
      <Section
        title="Endpoint"
        description="Configure any S3-compatible client with this endpoint. Path-style URLs are required (forcePathStyle: true)."
      >
        <div className="flex items-center gap-2">
          <Input readOnly value={endpoint} className="font-mono text-sm" />
          <CopyButton text={endpoint} showText={false} disabled={!endpoint} />
        </div>
      </Section>

      <Section
        title="Region"
        description="SigV4 signing region expected by the gateway. Clients must sign with this exact value (configurable server-side via AWS_REGION)."
      >
        <div className="flex items-center gap-2">
          <Input readOnly value={region} className="w-48 font-mono text-sm" />
          <CopyButton text={region} showText={false} disabled={!region} />
        </div>
      </Section>

      <Section
        title="Access Keys"
        description="Access keys grant project-admin-level access to all buckets via the S3 protocol. The Secret Access Key is only shown once at creation — save it somewhere safe."
      >
        {isLoading ? (
          <div className="text-sm text-muted-foreground">Loading access keys...</div>
        ) : error ? (
          <div className="text-sm text-destructive">
            Failed to load access keys: {error instanceof Error ? error.message : String(error)}
          </div>
        ) : (
          <div className="flex flex-col gap-3">
            {keys.length === 0 ? (
              <div className="rounded-md border border-dashed border-border px-4 py-6 text-center text-sm text-muted-foreground">
                No access keys yet.
              </div>
            ) : (
              <div className="overflow-hidden rounded-md border border-border">
                <table className="w-full text-sm">
                  <thead className="bg-[rgb(var(--semantic-1))] text-left text-xs uppercase tracking-wide text-muted-foreground">
                    <tr>
                      <th className="px-4 py-2 font-medium">Access Key ID</th>
                      <th className="px-4 py-2 font-medium">Description</th>
                      <th className="px-4 py-2 font-medium">Created</th>
                      <th className="px-4 py-2 font-medium">Last Used</th>
                      <th className="px-4 py-2" />
                    </tr>
                  </thead>
                  <tbody>
                    {keys.map((k) => (
                      <tr key={k.id} className="border-t border-border">
                        <td className="px-4 py-2 font-mono text-xs text-foreground">
                          <div className="flex items-center gap-2">
                            <KeyRound className="h-4 w-4 text-muted-foreground" />
                            {k.accessKeyId}
                          </div>
                        </td>
                        <td className="px-4 py-2 text-foreground">{k.description ?? '—'}</td>
                        <td className="px-4 py-2 text-muted-foreground">
                          {new Date(k.createdAt).toLocaleDateString()}
                        </td>
                        <td className="px-4 py-2 text-muted-foreground">
                          {formatRelative(k.lastUsedAt)}
                        </td>
                        <td className="px-4 py-2 text-right">
                          <Button
                            type="button"
                            variant="ghost"
                            size="icon"
                            aria-label="Revoke access key"
                            onClick={() => setPendingDelete(k)}
                          >
                            <Trash2 className="h-4 w-4" />
                          </Button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
            <div>
              <Button type="button" onClick={() => setCreateOpen(true)}>
                New access key
              </Button>
            </div>
          </div>
        )}
      </Section>

      <S3AccessKeyCreateDialog
        open={createOpen}
        onOpenChange={setCreateOpen}
        onCreate={(description) => createAccessKey({ description })}
        isCreating={isCreating}
      />

      <ConfirmDialog
        open={pendingDelete !== null}
        onOpenChange={(o) => !o && setPendingDelete(null)}
        title="Revoke S3 access key?"
        description={
          pendingDelete
            ? `The access key ${pendingDelete.accessKeyId} will stop working immediately. Any client still using it will start getting InvalidAccessKeyId errors.`
            : ''
        }
        confirmText="Revoke"
        cancelText="Cancel"
        destructive
        isLoading={isDeleting}
        onConfirm={() => {
          if (pendingDelete) {
            deleteAccessKey(pendingDelete.id);
            setPendingDelete(null);
          }
        }}
      />
    </div>
  );
}
