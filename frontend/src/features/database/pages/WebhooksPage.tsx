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
  Pencil,
  Globe,
  Lock,
  Eye,
  EyeOff,
} from 'lucide-react';
import {
  Button,
  Input,
  Dialog,
  DialogBody,
  DialogContent,
  DialogDivider,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  Switch,
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@insforge/ui';
import { Label, TableHeader, EmptyState } from '@/components';
import { DatabaseStudioMenuPanel } from '../components/DatabaseSecondaryMenu';
import { useDatabaseWebhooks } from '../hooks/useDatabaseWebhooks';
import type { DatabaseWebhook, DbWebhookEvent } from '@insforge/shared-schemas';

const EVENT_COLORS: Record<DbWebhookEvent, string> = {
  INSERT: 'bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-400',
  UPDATE: 'bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-400',
  DELETE: 'bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-400',
};

const EVENT_ACTIVE_BORDER: Record<DbWebhookEvent, string> = {
  INSERT: 'ring-1 ring-green-500/40',
  UPDATE: 'ring-1 ring-blue-500/40',
  DELETE: 'ring-1 ring-red-500/40',
};

const ALL_EVENTS: DbWebhookEvent[] = ['INSERT', 'UPDATE', 'DELETE'];

interface WebhookFormData {
  name: string;
  tableName: string;
  events: DbWebhookEvent[];
  url: string;
  secret: string;
  enabled: boolean;
}

const DEFAULT_FORM: WebhookFormData = {
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
    updateWebhook,
    deleteWebhook,
    toggleWebhook,
    fetchLogs,
  } = useDatabaseWebhooks();

  const [searchQuery, setSearchQuery] = useState('');
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [dialogMode, setDialogMode] = useState<'create' | 'edit' | null>(null);
  const [editingWebhook, setEditingWebhook] = useState<DatabaseWebhook | null>(null);
  const [form, setForm] = useState<WebhookFormData>(DEFAULT_FORM);
  const [formError, setFormError] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [deleteConfirmId, setDeleteConfirmId] = useState<string | null>(null);
  const [showSecret, setShowSecret] = useState(false);

  const filtered = useMemo(() => {
    if (!searchQuery.trim()) {
      return webhooks;
    }
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

  const openCreateDialog = () => {
    setForm(DEFAULT_FORM);
    setFormError('');
    setShowSecret(false);
    setEditingWebhook(null);
    setDialogMode('create');
  };

  const openEditDialog = (webhook: DatabaseWebhook) => {
    setForm({
      name: webhook.name,
      tableName: webhook.tableName,
      events: webhook.events as DbWebhookEvent[],
      url: webhook.url,
      secret: '',
      enabled: webhook.enabled,
    });
    setFormError('');
    setShowSecret(false);
    setEditingWebhook(webhook);
    setDialogMode('edit');
  };

  const closeDialog = () => {
    setDialogMode(null);
    setEditingWebhook(null);
    setFormError('');
    setShowSecret(false);
  };

  const toggleEvent = (event: DbWebhookEvent) => {
    setForm((prev) => ({
      ...prev,
      events: prev.events.includes(event)
        ? prev.events.filter((e) => e !== event)
        : [...prev.events, event],
    }));
  };

  const validateForm = (): string | null => {
    if (!form.name.trim()) {
      return 'Name is required';
    }
    if (!form.tableName.trim()) {
      return 'Table name is required';
    }
    if (form.events.length === 0) {
      return 'Select at least one event';
    }
    if (!form.url.trim()) {
      return 'URL is required';
    }
    try {
      new URL(form.url);
    } catch {
      return 'Enter a valid URL (e.g. https://example.com/hook)';
    }
    return null;
  };

  const handleSubmit = async () => {
    setFormError('');
    const err = validateForm();
    if (err) {
      return setFormError(err);
    }

    setIsSubmitting(true);
    try {
      if (dialogMode === 'create') {
        await createWebhook({
          name: form.name.trim(),
          tableName: form.tableName.trim(),
          events: form.events,
          url: form.url.trim(),
          secret: form.secret.trim() || undefined,
          enabled: form.enabled,
        });
      } else if (dialogMode === 'edit' && editingWebhook) {
        const updates: Record<string, unknown> = {};
        if (form.name.trim() !== editingWebhook.name) {
          updates.name = form.name.trim();
        }
        if (form.url.trim() !== editingWebhook.url) {
          updates.url = form.url.trim();
        }
        if (form.enabled !== editingWebhook.enabled) {
          updates.enabled = form.enabled;
        }
        if (form.secret.trim()) {
          updates.secret = form.secret.trim();
        }
        const eventsChanged =
          form.events.length !== editingWebhook.events.length ||
          form.events.some((e) => !editingWebhook.events.includes(e));
        if (eventsChanged) {
          updates.events = form.events;
        }
        await updateWebhook(editingWebhook.id, updates);
      }
      closeDialog();
    } catch (e) {
      setFormError(e instanceof Error ? e.message : 'Something went wrong');
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
    if (expandedId === id) {
      setExpandedId(null);
    }
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

                <Button size="sm" className="h-8 gap-1" onClick={openCreateDialog}>
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
                <Button size="sm" onClick={openCreateDialog}>
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
                  onEdit={() => openEditDialog(webhook)}
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

      {/* Create / Edit Webhook Dialog */}
      <Dialog open={dialogMode !== null} onOpenChange={(open) => !open && closeDialog()}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              {dialogMode === 'create' ? 'Create Database Webhook' : 'Edit Webhook'}
            </DialogTitle>
          </DialogHeader>

          <DialogBody>
            {/* Name */}
            <div className="flex gap-6 items-start">
              <div className="flex w-[180px] shrink-0 flex-col gap-1">
                <Label htmlFor="wh-name" className="leading-5 text-foreground">
                  Name
                </Label>
                <p className="text-[13px] leading-[18px] text-muted-foreground">
                  A friendly label for this webhook
                </p>
              </div>
              <div className="min-w-0 flex-1">
                <Input
                  id="wh-name"
                  placeholder="e.g. Notify on new orders"
                  value={form.name}
                  onChange={(e) => setForm((p) => ({ ...p, name: e.target.value }))}
                  className="h-8 rounded bg-[var(--alpha-4)] px-2 py-1.5 text-[13px] leading-[18px]"
                />
              </div>
            </div>

            <DialogDivider />

            {/* Table */}
            <div className="flex gap-6 items-start">
              <div className="flex w-[180px] shrink-0 flex-col gap-1">
                <Label htmlFor="wh-table" className="leading-5 text-foreground">
                  Table
                </Label>
                <p className="text-[13px] leading-[18px] text-muted-foreground">
                  The table to watch for changes
                </p>
              </div>
              <div className="min-w-0 flex-1">
                <Input
                  id="wh-table"
                  placeholder="e.g. orders"
                  value={form.tableName}
                  onChange={(e) => setForm((p) => ({ ...p, tableName: e.target.value }))}
                  disabled={dialogMode === 'edit'}
                  className="h-8 rounded bg-[var(--alpha-4)] px-2 py-1.5 text-[13px] leading-[18px] disabled:opacity-50"
                />
                {dialogMode === 'edit' && (
                  <p className="mt-1 text-[11px] text-muted-foreground">
                    Table cannot be changed after creation
                  </p>
                )}
              </div>
            </div>

            <DialogDivider />

            {/* Events */}
            <div className="flex gap-6 items-start">
              <div className="flex w-[180px] shrink-0 flex-col gap-1">
                <Label className="leading-5 text-foreground">Events</Label>
                <p className="text-[13px] leading-[18px] text-muted-foreground">
                  Which row operations should trigger this webhook
                </p>
              </div>
              <div className="min-w-0 flex-1 flex gap-2">
                {ALL_EVENTS.map((event) => {
                  const active = form.events.includes(event);
                  return (
                    <button
                      key={event}
                      type="button"
                      onClick={() => toggleEvent(event)}
                      className={`px-3 py-1.5 rounded-md text-xs font-medium transition-all ${
                        active
                          ? EVENT_COLORS[event] + ' ' + EVENT_ACTIVE_BORDER[event]
                          : 'bg-[var(--alpha-4)] text-muted-foreground hover:bg-[var(--alpha-8)]'
                      }`}
                    >
                      {event}
                    </button>
                  );
                })}
              </div>
            </div>

            <DialogDivider />

            {/* URL */}
            <div className="flex gap-6 items-start">
              <div className="flex w-[180px] shrink-0 flex-col gap-1">
                <Label htmlFor="wh-url" className="leading-5 text-foreground">
                  Endpoint URL
                </Label>
                <p className="text-[13px] leading-[18px] text-muted-foreground">
                  The HTTP endpoint that will receive POST requests
                </p>
              </div>
              <div className="min-w-0 flex-1">
                <div className="relative">
                  <Globe className="absolute left-2 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
                  <Input
                    id="wh-url"
                    placeholder="https://your-backend.com/webhooks"
                    value={form.url}
                    onChange={(e) => setForm((p) => ({ ...p, url: e.target.value }))}
                    className="h-8 rounded bg-[var(--alpha-4)] pl-7 pr-2 py-1.5 text-[13px] leading-[18px]"
                  />
                </div>
              </div>
            </div>

            <DialogDivider />

            {/* Secret */}
            <div className="flex gap-6 items-start">
              <div className="flex w-[180px] shrink-0 flex-col gap-1">
                <Label htmlFor="wh-secret" className="leading-5 text-foreground">
                  Signing Secret
                </Label>
                <p className="text-[13px] leading-[18px] text-muted-foreground">
                  {dialogMode === 'edit'
                    ? 'Leave blank to keep existing secret'
                    : 'Optional HMAC-SHA256 signing key'}
                </p>
              </div>
              <div className="min-w-0 flex-1">
                <div className="relative">
                  <Lock className="absolute left-2 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
                  <Input
                    id="wh-secret"
                    type={showSecret ? 'text' : 'password'}
                    placeholder={
                      dialogMode === 'edit' ? 'Enter new secret to update' : 'Optional signing key'
                    }
                    value={form.secret}
                    onChange={(e) => setForm((p) => ({ ...p, secret: e.target.value }))}
                    className="h-8 rounded bg-[var(--alpha-4)] pl-7 pr-8 py-1.5 text-[13px] leading-[18px]"
                  />
                  <button
                    type="button"
                    onClick={() => setShowSecret((v) => !v)}
                    className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                  >
                    {showSecret ? (
                      <EyeOff className="h-3.5 w-3.5" />
                    ) : (
                      <Eye className="h-3.5 w-3.5" />
                    )}
                  </button>
                </div>
              </div>
            </div>

            <DialogDivider />

            {/* Enabled */}
            <div className="flex gap-6 items-center">
              <div className="w-[180px] shrink-0">
                <Label htmlFor="wh-enabled" className="leading-5 text-foreground">
                  Enabled
                </Label>
              </div>
              <div className="min-w-0 flex-1 flex justify-end">
                <Switch
                  id="wh-enabled"
                  checked={form.enabled}
                  onCheckedChange={(v) => setForm((p) => ({ ...p, enabled: v }))}
                />
              </div>
            </div>

            {formError && (
              <>
                <DialogDivider />
                <p className="text-sm text-destructive">{formError}</p>
              </>
            )}
          </DialogBody>

          <DialogFooter>
            <Button
              type="button"
              variant="secondary"
              onClick={closeDialog}
              disabled={isSubmitting}
              className="h-8 rounded px-2"
            >
              Cancel
            </Button>
            <Button
              onClick={() => void handleSubmit()}
              disabled={isSubmitting}
              className="h-8 rounded px-2"
            >
              {isSubmitting
                ? dialogMode === 'create'
                  ? 'Creating...'
                  : 'Saving...'
                : dialogMode === 'create'
                  ? 'Create Webhook'
                  : 'Save Changes'}
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
  onEdit: () => void;
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
  onEdit,
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
            <span className="text-xs text-muted-foreground font-mono bg-[var(--alpha-4)] px-1.5 py-0.5 rounded">
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
          <div className="flex items-center gap-2">
            <Switch
              size="sm"
              checked={webhook.enabled}
              onCheckedChange={onToggle}
              aria-label={webhook.enabled ? 'Disable webhook' : 'Enable webhook'}
            />
            <span
              className={`text-xs font-medium min-w-[40px] ${
                webhook.enabled ? 'text-[rgb(var(--insforge-green-600))]' : 'text-muted-foreground'
              }`}
            >
              {webhook.enabled ? 'Active' : 'Paused'}
            </span>
          </div>

          <div className="flex items-center gap-0.5">
            <Button
              size="icon"
              variant="ghost"
              className="h-7 w-7 text-muted-foreground hover:text-foreground"
              onClick={onEdit}
            >
              <Pencil className="h-3.5 w-3.5" />
            </Button>

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
                <Trash2 className="h-3.5 w-3.5" />
              </Button>
            )}
          </div>
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
