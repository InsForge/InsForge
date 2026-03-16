import { useState, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Plus,
  Trash2,
  RefreshCw,
  ChevronDown,
  ChevronRight,
  CheckCircle2,
  XCircle,
} from 'lucide-react';
import {
  Button,
  Input,
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
  Switch,
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@insforge/ui';
import { Label } from '@/components';
import { DatabaseStudioMenuPanel } from '../components/DatabaseSecondaryMenu';
import { TableHeader, EmptyState } from '@/components';
import { useDatabaseWebhooks } from '../hooks/useDatabaseWebhooks';
import type { DatabaseWebhook, DbWebhookEvent } from '@insforge/shared-schemas';

const EVENT_COLORS: Record<DbWebhookEvent, string> = {
  INSERT: 'bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-400',
  UPDATE: 'bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-400',
  DELETE: 'bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-400',
};

const ALL_EVENTS: DbWebhookEvent[] = ['INSERT', 'UPDATE', 'DELETE'];

interface CreateWebhookForm {
  name: string;
  tableName: string;
  events: DbWebhookEvent[];
  url: string;
  secret: string;
  enabled: boolean;
}

const DEFAULT_FORM: CreateWebhookForm = {
  name: '',
  tableName: '',
  events: ['INSERT'],
  url: '',
  secret: '',
  enabled: true,
};

export default function WebhooksPage() {
  const navigate = useNavigate();
  const {
    webhooks,
    logs,
    isLoading,
    error,
    refetch,
    createWebhook,
    deleteWebhook,
    toggleWebhook,
    fetchLogs,
  } = useDatabaseWebhooks();

  const [searchQuery, setSearchQuery] = useState('');
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [showCreateDialog, setShowCreateDialog] = useState(false);
  const [form, setForm] = useState<CreateWebhookForm>(DEFAULT_FORM);
  const [formError, setFormError] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [deleteConfirmId, setDeleteConfirmId] = useState<string | null>(null);

  const filtered = useMemo(() => {
    if (!searchQuery.trim()) return webhooks;
    const q = searchQuery.toLowerCase();
    return webhooks.filter(
      (w) =>
        w.name.toLowerCase().includes(q) ||
        w.tableName.toLowerCase().includes(q) ||
        w.url.toLowerCase().includes(q)
    );
  }, [webhooks, searchQuery]);

  const handleRefresh = async () => {
    setIsRefreshing(true);
    try {
      setSearchQuery('');
      await refetch();
    } finally {
      setIsRefreshing(false);
    }
  };

  const toggleEvent = (event: DbWebhookEvent) => {
    setForm((prev) => ({
      ...prev,
      events: prev.events.includes(event)
        ? prev.events.filter((e) => e !== event)
        : [...prev.events, event],
    }));
  };

  const handleCreate = async () => {
    setFormError('');

    if (!form.name.trim()) return setFormError('Name is required');
    if (!form.tableName.trim()) return setFormError('Table name is required');
    if (form.events.length === 0) return setFormError('Select at least one event');
    if (!form.url.trim()) return setFormError('URL is required');

    try {
      new URL(form.url);
    } catch {
      return setFormError('Enter a valid URL (e.g. https://example.com/hook)');
    }

    setIsSubmitting(true);
    try {
      await createWebhook({
        name: form.name.trim(),
        tableName: form.tableName.trim(),
        events: form.events,
        url: form.url.trim(),
        secret: form.secret.trim() || undefined,
        enabled: form.enabled,
      });
      setShowCreateDialog(false);
      setForm(DEFAULT_FORM);
    } catch (err) {
      setFormError(err instanceof Error ? err.message : 'Failed to create webhook');
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleExpand = async (id: string) => {
    if (expandedId === id) {
      setExpandedId(null);
      return;
    }
    setExpandedId(id);
    await fetchLogs(id);
  };

  const handleDelete = async (id: string) => {
    await deleteWebhook(id);
    setDeleteConfirmId(null);
    if (expandedId === id) setExpandedId(null);
  };

  if (error) {
    return (
      <div className="flex h-full min-h-0 overflow-hidden bg-[rgb(var(--semantic-1))]">
        <DatabaseStudioMenuPanel
          onBack={() =>
            void navigate('/dashboard/database/tables', { state: { slideFromStudio: true } })
          }
        />
        <div className="min-w-0 flex-1 flex items-center justify-center">
          <EmptyState
            title="Failed to load webhooks"
            description={error instanceof Error ? error.message : 'An error occurred'}
          />
        </div>
      </div>
    );
  }

  return (
    <div className="flex h-full min-h-0 overflow-hidden bg-[rgb(var(--semantic-1))]">
      <DatabaseStudioMenuPanel
        onBack={() =>
          void navigate('/dashboard/database/tables', { state: { slideFromStudio: true } })
        }
      />

      <div className="min-w-0 flex-1 flex flex-col overflow-hidden">
        <TableHeader
          title="Database Webhooks"
          showDividerAfterTitle
          titleButtons={
            <TooltipProvider>
              <div className="flex items-center gap-1">
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-8 w-8 rounded p-1.5 text-muted-foreground hover:bg-[var(--alpha-4)]"
                      onClick={() => void handleRefresh()}
                      disabled={isRefreshing}
                    >
                      <RefreshCw className={isRefreshing ? 'h-5 w-5 animate-spin' : 'h-5 w-5'} />
                    </Button>
                  </TooltipTrigger>
                  <TooltipContent side="bottom">
                    <p>{isRefreshing ? 'Refreshing...' : 'Refresh'}</p>
                  </TooltipContent>
                </Tooltip>

                <Button
                  size="sm"
                  className="h-8 gap-1"
                  onClick={() => {
                    setForm(DEFAULT_FORM);
                    setFormError('');
                    setShowCreateDialog(true);
                  }}
                >
                  <Plus className="h-4 w-4" />
                  Add Webhook
                </Button>
              </div>
            </TooltipProvider>
          }
          searchValue={searchQuery}
          onSearchChange={setSearchQuery}
          searchPlaceholder="Search webhooks..."
        />

        <div className="flex-1 overflow-y-auto px-4 py-3">
          {isLoading ? (
            <div className="flex items-center justify-center h-40">
              <EmptyState title="Loading webhooks..." description="Please wait" />
            </div>
          ) : filtered.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-40 gap-3">
              <EmptyState
                title={searchQuery ? 'No webhooks match your search' : 'No webhooks yet'}
                description={
                  searchQuery
                    ? 'Try a different search term'
                    : 'Create a webhook to fire HTTP callbacks when rows change in your tables'
                }
              />
              {!searchQuery && (
                <Button
                  size="sm"
                  onClick={() => {
                    setForm(DEFAULT_FORM);
                    setFormError('');
                    setShowCreateDialog(true);
                  }}
                >
                  <Plus className="h-4 w-4 mr-1" />
                  Add your first webhook
                </Button>
              )}
            </div>
          ) : (
            <div className="flex flex-col gap-2">
              {filtered.map((webhook) => (
                <WebhookRow
                  key={webhook.id}
                  webhook={webhook}
                  isExpanded={expandedId === webhook.id}
                  deliveryLogs={logs[webhook.id] ?? []}
                  onExpand={() => void handleExpand(webhook.id)}
                  onToggle={() => void toggleWebhook(webhook.id, !webhook.enabled)}
                  onDeleteClick={() => setDeleteConfirmId(webhook.id)}
                  deleteConfirm={deleteConfirmId === webhook.id}
                  onDeleteConfirm={() => void handleDelete(webhook.id)}
                  onDeleteCancel={() => setDeleteConfirmId(null)}
                />
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Create Webhook Dialog */}
      <Dialog open={showCreateDialog} onOpenChange={setShowCreateDialog}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Create Database Webhook</DialogTitle>
          </DialogHeader>

          <div className="flex flex-col gap-4 py-2">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="wh-name">Name</Label>
              <Input
                id="wh-name"
                placeholder="e.g. Notify on new orders"
                value={form.name}
                onChange={(e) => setForm((p) => ({ ...p, name: e.target.value }))}
              />
            </div>

            <div className="flex flex-col gap-1.5">
              <Label htmlFor="wh-table">Table</Label>
              <Input
                id="wh-table"
                placeholder="e.g. orders"
                value={form.tableName}
                onChange={(e) => setForm((p) => ({ ...p, tableName: e.target.value }))}
              />
            </div>

            <div className="flex flex-col gap-1.5">
              <Label>Events</Label>
              <div className="flex gap-2">
                {ALL_EVENTS.map((event) => (
                  <button
                    key={event}
                    type="button"
                    onClick={() => toggleEvent(event)}
                    className={`px-3 py-1 rounded text-xs font-medium border transition-colors ${
                      form.events.includes(event)
                        ? EVENT_COLORS[event] + ' border-transparent'
                        : 'border-border text-muted-foreground hover:bg-alpha-4'
                    }`}
                  >
                    {event}
                  </button>
                ))}
              </div>
            </div>

            <div className="flex flex-col gap-1.5">
              <Label htmlFor="wh-url">URL</Label>
              <Input
                id="wh-url"
                placeholder="https://your-backend.com/webhooks/orders"
                value={form.url}
                onChange={(e) => setForm((p) => ({ ...p, url: e.target.value }))}
              />
            </div>

            <div className="flex flex-col gap-1.5">
              <Label htmlFor="wh-secret">
                Signing Secret <span className="text-muted-foreground font-normal">(optional)</span>
              </Label>
              <Input
                id="wh-secret"
                type="password"
                placeholder="Used to generate X-InsForge-Signature header"
                value={form.secret}
                onChange={(e) => setForm((p) => ({ ...p, secret: e.target.value }))}
              />
            </div>

            <div className="flex items-center gap-2">
              <Switch
                id="wh-enabled"
                checked={form.enabled}
                onCheckedChange={(v) => setForm((p) => ({ ...p, enabled: v }))}
              />
              <Label htmlFor="wh-enabled">Enable webhook immediately</Label>
            </div>

            {formError && <p className="text-sm text-destructive">{formError}</p>}
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setShowCreateDialog(false)}>
              Cancel
            </Button>
            <Button onClick={() => void handleCreate()} disabled={isSubmitting}>
              {isSubmitting ? 'Creating...' : 'Create Webhook'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

// ============================================================================
// WebhookRow sub-component
// ============================================================================

interface WebhookRowProps {
  webhook: DatabaseWebhook;
  isExpanded: boolean;
  deliveryLogs: Array<{
    id: string;
    eventType: string;
    success: boolean;
    statusCode: number | null;
    error: string | null;
    deliveredAt: string;
  }>;
  onExpand: () => void;
  onToggle: () => void;
  onDeleteClick: () => void;
  deleteConfirm: boolean;
  onDeleteConfirm: () => void;
  onDeleteCancel: () => void;
}

function WebhookRow({
  webhook,
  isExpanded,
  deliveryLogs,
  onExpand,
  onToggle,
  onDeleteClick,
  deleteConfirm,
  onDeleteConfirm,
  onDeleteCancel,
}: WebhookRowProps) {
  return (
    <div className="rounded-lg border border-border bg-[rgb(var(--semantic-2))] overflow-hidden">
      {/* Header row */}
      <div className="flex items-center gap-3 px-4 py-3">
        <button
          type="button"
          onClick={onExpand}
          className="text-muted-foreground hover:text-foreground transition-colors"
        >
          {isExpanded ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
        </button>

        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="font-medium text-sm truncate">{webhook.name}</span>
            <span className="text-xs text-muted-foreground font-mono bg-alpha-4 px-1.5 py-0.5 rounded">
              {webhook.tableName}
            </span>
            {webhook.events.map((ev) => (
              <span
                key={ev}
                className={`inline-flex items-center px-1.5 py-0.5 rounded text-xs font-medium ${EVENT_COLORS[ev as DbWebhookEvent]}`}
              >
                {ev}
              </span>
            ))}
          </div>
          <p className="text-xs text-muted-foreground truncate mt-0.5">{webhook.url}</p>
        </div>

        <div className="flex items-center gap-2 shrink-0">
          <TooltipProvider>
            <Tooltip>
              <TooltipTrigger asChild>
                <Switch
                  checked={webhook.enabled}
                  onCheckedChange={onToggle}
                  aria-label={webhook.enabled ? 'Disable webhook' : 'Enable webhook'}
                />
              </TooltipTrigger>
              <TooltipContent side="top">
                {webhook.enabled ? 'Enabled — click to disable' : 'Disabled — click to enable'}
              </TooltipContent>
            </Tooltip>
          </TooltipProvider>

          {deleteConfirm ? (
            <div className="flex items-center gap-1">
              <Button
                size="sm"
                variant="destructive"
                className="h-7 text-xs"
                onClick={onDeleteConfirm}
              >
                Confirm
              </Button>
              <Button size="sm" variant="ghost" className="h-7 text-xs" onClick={onDeleteCancel}>
                Cancel
              </Button>
            </div>
          ) : (
            <Button
              size="icon"
              variant="ghost"
              className="h-7 w-7 text-muted-foreground hover:text-destructive"
              onClick={onDeleteClick}
            >
              <Trash2 className="h-4 w-4" />
            </Button>
          )}
        </div>
      </div>

      {/* Delivery logs */}
      {isExpanded && (
        <div className="border-t border-border px-4 pb-3">
          <p className="text-xs font-medium text-muted-foreground py-2">Recent Deliveries</p>
          {deliveryLogs.length === 0 ? (
            <p className="text-xs text-muted-foreground">No delivery attempts yet</p>
          ) : (
            <div className="flex flex-col gap-1">
              {deliveryLogs.map((log) => (
                <div key={log.id} className="flex items-center gap-2 text-xs py-1">
                  {log.success ? (
                    <CheckCircle2 className="h-3.5 w-3.5 text-green-500 shrink-0" />
                  ) : (
                    <XCircle className="h-3.5 w-3.5 text-destructive shrink-0" />
                  )}
                  <span
                    className={`font-medium shrink-0 ${
                      EVENT_COLORS[log.eventType as DbWebhookEvent]?.split(' ')[1] ?? ''
                    }`}
                  >
                    {log.eventType}
                  </span>
                  <span className="text-muted-foreground shrink-0">
                    {log.statusCode ? `HTTP ${log.statusCode}` : (log.error ?? 'Network error')}
                  </span>
                  <span className="text-muted-foreground ml-auto shrink-0">
                    {new Date(log.deliveredAt).toLocaleString()}
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
