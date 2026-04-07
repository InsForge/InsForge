# Compute Dashboard UX Fixes Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make Compute Services usable from the dashboard — add action buttons, create dialog, logs panel, and fix broken endpoint URLs.

**Architecture:** Incremental additions to the existing ComputePage + ServiceCard components. All API methods and mutations already exist in hooks/services. We're just wiring UI to existing plumbing. No backend changes.

**Tech Stack:** React, TypeScript, @insforge/ui (Radix-based), @tanstack/react-query, lucide-react icons

**Spec:** `docs/superpowers/specs/2026-04-07-compute-dashboard-ux-design.md`

---

### File Map

| File | Action | Responsibility |
|------|--------|----------------|
| `packages/dashboard/src/features/compute/constants.ts` | Modify | Add `getReachableUrl` helper, region labels |
| `packages/dashboard/src/features/compute/hooks/useComputeServices.ts` | Modify | Add `useLogs` hook export |
| `packages/dashboard/src/features/compute/components/ServiceLogs.tsx` | Create | Log entries display with refresh |
| `packages/dashboard/src/features/compute/components/CreateServiceDialog.tsx` | Create | Create service form dialog |
| `packages/dashboard/src/features/compute/components/ServiceCard.tsx` | Modify | Add dropdown menu with actions |
| `packages/dashboard/src/features/compute/pages/ComputePage.tsx` | Modify | Add create button, action buttons, logs, enhanced detail view |

---

### Task 1: Add helper utilities to constants.ts

**Files:**
- Modify: `packages/dashboard/src/features/compute/constants.ts`

- [ ] **Step 1: Add `getReachableUrl` helper and region labels**

```ts
import type { ServiceSchema, ServiceStatus } from '@insforge/shared-schemas';

export const statusColors: Record<ServiceStatus, string> = {
  running: 'bg-green-500',
  deploying: 'bg-yellow-500',
  creating: 'bg-yellow-500',
  stopped: 'bg-gray-400',
  failed: 'bg-red-500',
  destroying: 'bg-orange-500',
};

export const CPU_TIERS = [
  { value: 'shared-1x', label: 'Shared 1x' },
  { value: 'shared-2x', label: 'Shared 2x' },
  { value: 'performance-1x', label: 'Performance 1x' },
  { value: 'performance-2x', label: 'Performance 2x' },
  { value: 'performance-4x', label: 'Performance 4x' },
] as const;

export const MEMORY_OPTIONS = [256, 512, 1024, 2048, 4096, 8192] as const;

export const REGIONS = [
  { value: 'iad', label: 'Ashburn, VA (iad)' },
  { value: 'sin', label: 'Singapore (sin)' },
  { value: 'lax', label: 'Los Angeles (lax)' },
  { value: 'lhr', label: 'London (lhr)' },
  { value: 'nrt', label: 'Tokyo (nrt)' },
  { value: 'ams', label: 'Amsterdam (ams)' },
  { value: 'syd', label: 'Sydney (syd)' },
] as const;

/** Return the actual reachable .fly.dev URL instead of a custom domain that may not resolve */
export function getReachableUrl(service: ServiceSchema): string | null {
  if (service.flyAppId) {
    return `https://${service.flyAppId}.fly.dev`;
  }
  return service.endpointUrl;
}
```

- [ ] **Step 2: Commit**

```bash
git add packages/dashboard/src/features/compute/constants.ts
git commit -m "feat(compute/ui): add helper utilities for create form and endpoint URL"
```

---

### Task 2: Add useLogs hook to useComputeServices

**Files:**
- Modify: `packages/dashboard/src/features/compute/hooks/useComputeServices.ts`

- [ ] **Step 1: Add useLogs query hook**

Add this new exported hook after the existing `useComputeServices` function in the same file:

```ts
export function useServiceLogs(serviceId: string | null) {
  return useQuery({
    queryKey: ['compute', 'services', serviceId, 'logs'],
    queryFn: () => computeServicesApi.logs(serviceId!, 50),
    enabled: !!serviceId,
    staleTime: 0, // always refetch on mount for logs
  });
}
```

This requires adding `useQuery` to the imports (it's already imported, just need to use it in the new hook).

- [ ] **Step 2: Commit**

```bash
git add packages/dashboard/src/features/compute/hooks/useComputeServices.ts
git commit -m "feat(compute/ui): add useServiceLogs hook"
```

---

### Task 3: Create ServiceLogs component

**Files:**
- Create: `packages/dashboard/src/features/compute/components/ServiceLogs.tsx`

- [ ] **Step 1: Create the logs display component**

```tsx
import { RefreshCw } from 'lucide-react';
import { Button } from '@insforge/ui';
import { useServiceLogs } from '../hooks/useComputeServices';

interface ServiceLogsProps {
  serviceId: string;
}

export function ServiceLogs({ serviceId }: ServiceLogsProps) {
  const { data: logs = [], isLoading, refetch, isFetching } = useServiceLogs(serviceId);

  return (
    <div className="bg-card border border-[var(--alpha-8)] rounded-lg overflow-hidden">
      <div className="flex items-center justify-between px-4 py-3 border-b border-[var(--alpha-8)]">
        <h3 className="text-sm font-medium text-foreground">Logs</h3>
        <Button
          variant="ghost"
          size="sm"
          onClick={() => void refetch()}
          disabled={isFetching}
        >
          <RefreshCw className={`h-3.5 w-3.5 ${isFetching ? 'animate-spin' : ''}`} />
          Refresh
        </Button>
      </div>
      <div className="max-h-[300px] overflow-y-auto p-4">
        {isLoading ? (
          <p className="text-xs text-muted-foreground">Loading logs...</p>
        ) : logs.length === 0 ? (
          <p className="text-xs text-muted-foreground">No logs available.</p>
        ) : (
          <pre className="text-xs font-mono text-muted-foreground space-y-0.5">
            {logs.map((entry, i) => (
              <div key={i}>
                <span className="text-foreground/60">
                  {new Date(entry.timestamp).toISOString().replace('T', ' ').slice(0, 19)}
                </span>
                {'  '}
                {entry.message}
              </div>
            ))}
          </pre>
        )}
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add packages/dashboard/src/features/compute/components/ServiceLogs.tsx
git commit -m "feat(compute/ui): add ServiceLogs component"
```

---

### Task 4: Create CreateServiceDialog component

**Files:**
- Create: `packages/dashboard/src/features/compute/components/CreateServiceDialog.tsx`

- [ ] **Step 1: Create the dialog component**

```tsx
import { useState } from 'react';
import {
  Button,
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogBody,
  DialogFooter,
  Input,
  Select,
  SelectTrigger,
  SelectValue,
  SelectContent,
  SelectItem,
} from '@insforge/ui';
import { CPU_TIERS, MEMORY_OPTIONS, REGIONS } from '../constants';
import type { CreateServiceRequest } from '@insforge/shared-schemas';

interface CreateServiceDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onCreate: (data: CreateServiceRequest) => Promise<unknown>;
  isCreating: boolean;
}

export function CreateServiceDialog({
  open,
  onOpenChange,
  onCreate,
  isCreating,
}: CreateServiceDialogProps) {
  const [name, setName] = useState('');
  const [imageUrl, setImageUrl] = useState('');
  const [port, setPort] = useState('8080');
  const [cpu, setCpu] = useState('shared-1x');
  const [memory, setMemory] = useState('512');
  const [region, setRegion] = useState('iad');

  const resetForm = () => {
    setName('');
    setImageUrl('');
    setPort('8080');
    setCpu('shared-1x');
    setMemory('512');
    setRegion('iad');
  };

  const handleSubmit = async () => {
    await onCreate({
      name,
      imageUrl,
      port: Number(port),
      cpu: cpu as CreateServiceRequest['cpu'],
      memory: Number(memory),
      region,
    });
    resetForm();
    onOpenChange(false);
  };

  const isValid = name.length > 0 && imageUrl.length > 0 && Number(port) > 0;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-[520px]">
        <DialogHeader>
          <DialogTitle>Create Service</DialogTitle>
          <DialogDescription>Deploy a Docker container as a compute service.</DialogDescription>
        </DialogHeader>

        <DialogBody>
          <div className="flex flex-col gap-4">
            <div className="flex flex-col gap-1.5">
              <label className="text-sm font-medium text-foreground">Name</label>
              <Input
                placeholder="my-api"
                value={name}
                onChange={(e) => setName(e.target.value)}
              />
              <p className="text-xs text-muted-foreground">DNS-safe: lowercase, numbers, dashes</p>
            </div>

            <div className="flex flex-col gap-1.5">
              <label className="text-sm font-medium text-foreground">Image URL</label>
              <Input
                placeholder="nginx:alpine"
                value={imageUrl}
                onChange={(e) => setImageUrl(e.target.value)}
              />
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div className="flex flex-col gap-1.5">
                <label className="text-sm font-medium text-foreground">Port</label>
                <Input
                  type="number"
                  value={port}
                  onChange={(e) => setPort(e.target.value)}
                />
              </div>

              <div className="flex flex-col gap-1.5">
                <label className="text-sm font-medium text-foreground">Region</label>
                <Select value={region} onValueChange={setRegion}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {REGIONS.map((r) => (
                      <SelectItem key={r.value} value={r.value}>
                        {r.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div className="flex flex-col gap-1.5">
                <label className="text-sm font-medium text-foreground">CPU</label>
                <Select value={cpu} onValueChange={setCpu}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {CPU_TIERS.map((t) => (
                      <SelectItem key={t.value} value={t.value}>
                        {t.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div className="flex flex-col gap-1.5">
                <label className="text-sm font-medium text-foreground">Memory</label>
                <Select value={memory} onValueChange={setMemory}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {MEMORY_OPTIONS.map((m) => (
                      <SelectItem key={m} value={String(m)}>
                        {m} MB
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>
          </div>
        </DialogBody>

        <DialogFooter>
          <Button
            variant="secondary"
            size="lg"
            disabled={isCreating}
            onClick={() => onOpenChange(false)}
          >
            Cancel
          </Button>
          <Button
            variant="primary"
            size="lg"
            disabled={!isValid || isCreating}
            onClick={() => void handleSubmit()}
          >
            {isCreating ? 'Creating...' : 'Create Service'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add packages/dashboard/src/features/compute/components/CreateServiceDialog.tsx
git commit -m "feat(compute/ui): add CreateServiceDialog component"
```

---

### Task 5: Add dropdown menu to ServiceCard

**Files:**
- Modify: `packages/dashboard/src/features/compute/components/ServiceCard.tsx`

- [ ] **Step 1: Replace ServiceCard with version that has dropdown actions**

```tsx
import { ExternalLink, MoreVertical, Play, Square, Trash2 } from 'lucide-react';
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
} from '@insforge/ui';
import type { ServiceSchema } from '@insforge/shared-schemas';
import { statusColors, getReachableUrl } from '../constants';

interface ServiceCardProps {
  service: ServiceSchema;
  onClick: () => void;
  onStop: (id: string) => void;
  onStart: (id: string) => void;
  onDelete: (id: string) => void;
}

export function ServiceCard({ service, onClick, onStop, onStart, onDelete }: ServiceCardProps) {
  const reachableUrl = getReachableUrl(service);

  return (
    <div
      role="button"
      tabIndex={0}
      onClick={onClick}
      onKeyDown={(e) => { if (e.key === 'Enter') onClick(); }}
      className="w-full text-left bg-card border border-[var(--alpha-8)] rounded-lg p-4 hover:border-foreground/20 transition-colors cursor-pointer"
    >
      <div className="flex items-center justify-between mb-3">
        <h3 className="text-sm font-medium text-foreground truncate">{service.name}</h3>
        <div className="flex items-center gap-2">
          <span className="flex items-center gap-1.5 text-xs text-muted-foreground">
            <span className={`inline-block h-2 w-2 rounded-full ${statusColors[service.status]}`} />
            {service.status}
          </span>
          <DropdownMenu>
            <DropdownMenuTrigger
              onClick={(e) => e.stopPropagation()}
              className="inline-flex h-6 w-6 items-center justify-center rounded text-muted-foreground hover:bg-[var(--alpha-8)] hover:text-foreground"
            >
              <MoreVertical className="h-3.5 w-3.5" />
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" onClick={(e) => e.stopPropagation()}>
              {service.status === 'running' && (
                <DropdownMenuItem onClick={() => onStop(service.id)}>
                  <Square className="h-3.5 w-3.5" />
                  Stop
                </DropdownMenuItem>
              )}
              {service.status === 'stopped' && (
                <DropdownMenuItem onClick={() => onStart(service.id)}>
                  <Play className="h-3.5 w-3.5" />
                  Start
                </DropdownMenuItem>
              )}
              {(service.status === 'running' || service.status === 'stopped') && (
                <DropdownMenuSeparator />
              )}
              <DropdownMenuItem
                onClick={() => onDelete(service.id)}
                className="text-destructive"
              >
                <Trash2 className="h-3.5 w-3.5" />
                Delete
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>

      <p className="text-xs text-muted-foreground truncate mb-3" title={service.imageUrl}>
        {service.imageUrl === 'dockerfile' ? 'Built from Dockerfile' : service.imageUrl}
      </p>

      {reachableUrl && (
        <a
          href={reachableUrl}
          target="_blank"
          rel="noopener noreferrer"
          onClick={(e) => e.stopPropagation()}
          className="inline-flex items-center gap-1 text-xs text-primary hover:underline mb-3"
        >
          <ExternalLink className="h-3 w-3" />
          {reachableUrl}
        </a>
      )}

      <div className="flex items-center gap-3 text-xs text-muted-foreground pt-2 border-t border-[var(--alpha-8)]">
        <span>CPU: {service.cpu}</span>
        <span>Memory: {service.memory} MB</span>
        <span>{service.region}</span>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add packages/dashboard/src/features/compute/components/ServiceCard.tsx
git commit -m "feat(compute/ui): add dropdown actions and fix endpoint URL on ServiceCard"
```

---

### Task 6: Rebuild ComputePage with actions, create button, logs, and enhanced detail view

**Files:**
- Modify: `packages/dashboard/src/features/compute/pages/ComputePage.tsx`

- [ ] **Step 1: Replace ComputePage with the full implementation**

```tsx
import { useState } from 'react';
import { Loader2, ArrowLeft, Plus, Play, Square, Trash2, AlertTriangle } from 'lucide-react';
import { Button, ConfirmDialog } from '@insforge/ui';
import { useComputeServices } from '../hooks/useComputeServices';
import { ServiceCard } from '../components/ServiceCard';
import { ServiceLogs } from '../components/ServiceLogs';
import { CreateServiceDialog } from '../components/CreateServiceDialog';
import { statusColors, getReachableUrl } from '../constants';
import type { ServiceSchema } from '@insforge/shared-schemas';

export default function ComputePage() {
  const { services, isLoading, create, remove, stop, start, isCreating } = useComputeServices();
  const [selectedService, setSelectedService] = useState<ServiceSchema | null>(null);
  const [createOpen, setCreateOpen] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<string | null>(null);

  // Keep selected service in sync with latest data
  const currentService = selectedService
    ? services.find((s) => s.id === selectedService.id) ?? selectedService
    : null;

  const handleDelete = async (id: string) => {
    await remove(id);
    if (selectedService?.id === id) {
      setSelectedService(null);
    }
    setDeleteTarget(null);
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-64">
        <Loader2 className="w-8 h-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (currentService) {
    const reachableUrl = getReachableUrl(currentService);

    return (
      <div className="h-full flex flex-col bg-[rgb(var(--semantic-0))]">
        <div className="flex-1 min-h-0 overflow-y-auto px-10">
          <div className="max-w-[1024px] w-full mx-auto flex flex-col gap-6 pt-10 pb-6">
            <button
              type="button"
              onClick={() => setSelectedService(null)}
              className="flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground transition-colors self-start"
            >
              <ArrowLeft className="h-4 w-4" />
              Back to services
            </button>

            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <h1 className="text-2xl font-medium text-foreground leading-8">
                  {currentService.name}
                </h1>
                <span className="flex items-center gap-1.5 text-sm text-muted-foreground">
                  <span
                    className={`inline-block h-2 w-2 rounded-full ${statusColors[currentService.status]}`}
                  />
                  {currentService.status}
                </span>
              </div>

              <div className="flex items-center gap-2">
                {currentService.status === 'running' && (
                  <Button
                    variant="secondary"
                    size="sm"
                    onClick={() => void stop(currentService.id)}
                  >
                    <Square className="h-3.5 w-3.5" />
                    Stop
                  </Button>
                )}
                {currentService.status === 'stopped' && (
                  <Button
                    variant="secondary"
                    size="sm"
                    onClick={() => void start(currentService.id)}
                  >
                    <Play className="h-3.5 w-3.5" />
                    Start
                  </Button>
                )}
                <Button
                  variant="destructive"
                  size="sm"
                  onClick={() => setDeleteTarget(currentService.id)}
                >
                  <Trash2 className="h-3.5 w-3.5" />
                  Delete
                </Button>
              </div>
            </div>

            {currentService.status === 'failed' && (
              <div className="flex items-center gap-2 px-4 py-3 bg-destructive/10 border border-destructive/20 rounded-lg text-sm text-destructive">
                <AlertTriangle className="h-4 w-4 shrink-0" />
                This service failed to deploy. You can delete it and try again.
              </div>
            )}

            <div className="bg-card border border-[var(--alpha-8)] rounded-lg p-6">
              <dl className="grid grid-cols-2 gap-4 text-sm">
                <div>
                  <dt className="text-muted-foreground mb-1">Image</dt>
                  <dd className="text-foreground break-all">
                    {currentService.imageUrl === 'dockerfile'
                      ? 'Built from Dockerfile'
                      : currentService.imageUrl}
                  </dd>
                </div>
                <div>
                  <dt className="text-muted-foreground mb-1">Port</dt>
                  <dd className="text-foreground">{currentService.port}</dd>
                </div>
                <div>
                  <dt className="text-muted-foreground mb-1">CPU</dt>
                  <dd className="text-foreground">{currentService.cpu}</dd>
                </div>
                <div>
                  <dt className="text-muted-foreground mb-1">Memory</dt>
                  <dd className="text-foreground">{currentService.memory} MB</dd>
                </div>
                <div>
                  <dt className="text-muted-foreground mb-1">Region</dt>
                  <dd className="text-foreground">{currentService.region}</dd>
                </div>
                <div>
                  <dt className="text-muted-foreground mb-1">Created</dt>
                  <dd className="text-foreground">
                    {new Date(currentService.createdAt).toLocaleDateString(undefined, {
                      year: 'numeric',
                      month: 'short',
                      day: 'numeric',
                      hour: '2-digit',
                      minute: '2-digit',
                    })}
                  </dd>
                </div>
                <div className="col-span-2">
                  <dt className="text-muted-foreground mb-1">Endpoint URL</dt>
                  <dd className="text-foreground">
                    {reachableUrl ? (
                      <a
                        href={reachableUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-primary hover:underline"
                      >
                        {reachableUrl}
                      </a>
                    ) : (
                      <span className="text-muted-foreground">Not available</span>
                    )}
                  </dd>
                </div>
              </dl>
            </div>

            {currentService.flyMachineId && (
              <ServiceLogs serviceId={currentService.id} />
            )}
          </div>
        </div>

        <ConfirmDialog
          open={deleteTarget !== null}
          onOpenChange={(open) => { if (!open) setDeleteTarget(null); }}
          title="Delete service"
          description={`This will permanently delete "${currentService.name}" and destroy its Fly.io resources. This cannot be undone.`}
          confirmText="Delete"
          destructive
          onConfirm={() => handleDelete(deleteTarget!)}
        />
      </div>
    );
  }

  return (
    <div className="h-full flex flex-col bg-[rgb(var(--semantic-0))]">
      <div className="flex-1 min-h-0 overflow-y-auto px-10">
        <div className="max-w-[1024px] w-full mx-auto flex flex-col gap-8 pt-10 pb-6">
          {/* Services Section */}
          <div className="flex flex-col gap-4">
            <div className="flex items-center justify-between">
              <div className="flex flex-col gap-1">
                <h1 className="text-2xl font-medium text-foreground leading-8">Services</h1>
                <p className="text-sm leading-5 text-muted-foreground">
                  Deploy and manage long-running containers on your infrastructure.
                </p>
              </div>
              <Button variant="primary" size="sm" onClick={() => setCreateOpen(true)}>
                <Plus className="h-4 w-4" />
                Create Service
              </Button>
            </div>

            {services.length === 0 ? (
              <div className="bg-card border border-[var(--alpha-8)] rounded-lg p-8 text-center">
                <p className="text-sm text-muted-foreground mb-2">No services deployed yet.</p>
                <p className="text-xs text-muted-foreground mb-4">
                  Create a service using the button above or the CLI:{' '}
                  <code className="px-1.5 py-0.5 bg-muted rounded text-xs">
                    insforge compute create --name my-api --image nginx:alpine
                  </code>
                </p>
              </div>
            ) : (
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                {services.map((service) => (
                  <ServiceCard
                    key={service.id}
                    service={service}
                    onClick={() => setSelectedService(service)}
                    onStop={(id) => void stop(id)}
                    onStart={(id) => void start(id)}
                    onDelete={setDeleteTarget}
                  />
                ))}
              </div>
            )}
          </div>

          {/* Jobs Section Placeholder */}
          <div className="flex flex-col gap-2">
            <h2 className="text-lg font-medium text-foreground">Jobs</h2>
            <div className="bg-card border border-[var(--alpha-8)] rounded-lg p-6 text-center">
              <p className="text-sm text-muted-foreground">Coming soon</p>
            </div>
          </div>
        </div>
      </div>

      <CreateServiceDialog
        open={createOpen}
        onOpenChange={setCreateOpen}
        onCreate={create}
        isCreating={isCreating}
      />

      <ConfirmDialog
        open={deleteTarget !== null}
        onOpenChange={(open) => { if (!open) setDeleteTarget(null); }}
        title="Delete service"
        description="This will permanently delete this service and destroy its Fly.io resources. This cannot be undone."
        confirmText="Delete"
        destructive
        onConfirm={() => {
          if (deleteTarget) return handleDelete(deleteTarget);
        }}
      />
    </div>
  );
}
```

- [ ] **Step 2: Verify the app builds**

Run: `cd packages/dashboard && npx tsc --noEmit`
Expected: No type errors

- [ ] **Step 3: Commit**

```bash
git add packages/dashboard/src/features/compute/pages/ComputePage.tsx
git commit -m "feat(compute/ui): add create button, action buttons, logs panel, and enhanced detail view"
```

---

### Task 7: Verify everything works end-to-end

- [ ] **Step 1: Run type check across the whole project**

Run: `npm run typecheck`
Expected: No errors

- [ ] **Step 2: Run all tests**

Run: `npm test`
Expected: All 471+ tests pass

- [ ] **Step 3: Final commit if any fixes were needed**

```bash
git add -A
git commit -m "fix(compute/ui): address typecheck and test issues"
```
