import { useState } from 'react';
import {
  Loader2,
  ArrowLeft,
  Plus,
  Play,
  Square,
  Trash2,
  AlertTriangle,
  XCircle,
} from 'lucide-react';
import { Button, ConfirmDialog } from '@insforge/ui';
import { useComputeServices } from '../hooks/useComputeServices';
import { ServiceCard } from '../components/ServiceCard';
import { ServiceLogs } from '../components/ServiceLogs';
import { CreateServiceDialog } from '../components/CreateServiceDialog';
import { statusColors, getReachableUrl } from '../constants';
import type { ServiceSchema } from '@insforge/shared-schemas';

export default function ComputePage() {
  const {
    services,
    isLoading,
    error,
    create,
    remove,
    stop,
    start,
    isCreating,
    isDeleting,
    isStopping,
    isStarting,
  } = useComputeServices();
  const [selectedService, setSelectedService] = useState<ServiceSchema | null>(null);
  const [createOpen, setCreateOpen] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<string | null>(null);

  // Keep selected service in sync with latest data
  const currentService = selectedService
    ? (services.find((s) => s.id === selectedService.id) ?? selectedService)
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

  if (error) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="flex items-center gap-2 text-destructive">
          <XCircle className="w-5 h-5 shrink-0" />
          <span className="text-sm">Failed to load services. Please refresh the page.</span>
        </div>
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
                    disabled={isStopping || isDeleting}
                    onClick={() => void stop(currentService.id)}
                  >
                    <Square className="h-3.5 w-3.5" />
                    {isStopping ? 'Stopping...' : 'Stop'}
                  </Button>
                )}
                {currentService.status === 'stopped' && (
                  <Button
                    variant="secondary"
                    size="sm"
                    disabled={isStarting || isDeleting}
                    onClick={() => void start(currentService.id)}
                  >
                    <Play className="h-3.5 w-3.5" />
                    {isStarting ? 'Starting...' : 'Start'}
                  </Button>
                )}
                <Button
                  variant="destructive"
                  size="sm"
                  disabled={isDeleting || isStopping || isStarting}
                  onClick={() => setDeleteTarget(currentService.id)}
                >
                  <Trash2 className="h-3.5 w-3.5" />
                  {isDeleting ? 'Deleting...' : 'Delete'}
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
                <div>
                  <dt className="text-muted-foreground mb-1">Updated</dt>
                  <dd className="text-foreground">
                    {new Date(currentService.updatedAt).toLocaleDateString(undefined, {
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

            {currentService.flyMachineId && <ServiceLogs serviceId={currentService.id} />}
          </div>
        </div>

        <ConfirmDialog
          open={deleteTarget !== null}
          onOpenChange={(open) => {
            if (!open) {
              setDeleteTarget(null);
            }
          }}
          title="Delete service"
          description={`This will permanently delete "${currentService.name}" and destroy its Fly.io resources. This cannot be undone.`}
          confirmText="Delete"
          destructive
          onConfirm={() => {
            if (deleteTarget) {
              return handleDelete(deleteTarget);
            }
          }}
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
              <div className="bg-card border border-[var(--alpha-8)] rounded-lg p-8">
                <p className="text-sm text-muted-foreground mb-4 text-center">
                  No services deployed yet.
                </p>
                <div className="flex flex-col gap-3 max-w-xl mx-auto">
                  <div>
                    <p className="text-xs text-muted-foreground mb-1.5">
                      Use the button above, the CLI:
                    </p>
                    <code className="block px-3 py-2 bg-muted text-foreground rounded text-xs font-mono break-all">
                      npx @insforge/cli compute create --name my-api --image nginx:alpine
                    </code>
                  </div>
                  <div>
                    <p className="text-xs text-muted-foreground mb-1.5">Or ask your AI agent:</p>
                    <ul className="flex flex-col gap-1 text-xs text-foreground">
                      <li className="px-3 py-2 bg-muted rounded">
                        &ldquo;Deploy nginx:alpine on port 80 as a compute service&rdquo;
                      </li>
                      <li className="px-3 py-2 bg-muted rounded">
                        &ldquo;Deploy this FastAPI app in the current directory&rdquo;
                      </li>
                      <li className="px-3 py-2 bg-muted rounded">
                        &ldquo;Create a Redis container for caching&rdquo;
                      </li>
                    </ul>
                  </div>
                </div>
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
        onOpenChange={(open) => {
          if (!open) {
            setDeleteTarget(null);
          }
        }}
        title="Delete service"
        description="This will permanently delete this service and destroy its Fly.io resources. This cannot be undone."
        confirmText="Delete"
        destructive
        onConfirm={() => {
          if (deleteTarget) {
            return handleDelete(deleteTarget);
          }
        }}
      />
    </div>
  );
}
