import { useState } from 'react';
import { Loader2, ArrowLeft } from 'lucide-react';
import { useComputeServices } from '../hooks/useComputeServices';
import { ServiceCard } from '../components/ServiceCard';
import type { ServiceSchema, ServiceStatus } from '@insforge/shared-schemas';

const statusColors: Record<ServiceStatus, string> = {
  running: 'bg-green-500',
  deploying: 'bg-yellow-500',
  creating: 'bg-yellow-500',
  stopped: 'bg-gray-400',
  failed: 'bg-red-500',
  destroying: 'bg-orange-500',
};

export default function ComputePage() {
  const { services, isLoading } = useComputeServices();
  const [selectedService, setSelectedService] = useState<ServiceSchema | null>(null);

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-64">
        <Loader2 className="w-8 h-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (selectedService) {
    return (
      <div className="h-full flex flex-col bg-[rgb(var(--semantic-0))]">
        <div className="flex flex-col items-center px-10">
          <div className="max-w-[1024px] w-full flex flex-col gap-6 pt-10 pb-6">
            <button
              type="button"
              onClick={() => setSelectedService(null)}
              className="flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground transition-colors self-start"
            >
              <ArrowLeft className="h-4 w-4" />
              Back to services
            </button>

            <div className="flex items-center gap-3">
              <h1 className="text-2xl font-medium text-foreground leading-8">
                {selectedService.name}
              </h1>
              <span className="flex items-center gap-1.5 text-sm text-muted-foreground">
                <span
                  className={`inline-block h-2 w-2 rounded-full ${statusColors[selectedService.status]}`}
                />
                {selectedService.status}
              </span>
            </div>

            <div className="bg-card border border-[var(--alpha-8)] rounded-lg p-6">
              <dl className="grid grid-cols-2 gap-4 text-sm">
                <div>
                  <dt className="text-muted-foreground mb-1">Image</dt>
                  <dd className="text-foreground break-all">{selectedService.imageUrl}</dd>
                </div>
                <div>
                  <dt className="text-muted-foreground mb-1">Port</dt>
                  <dd className="text-foreground">{selectedService.port}</dd>
                </div>
                <div>
                  <dt className="text-muted-foreground mb-1">CPU</dt>
                  <dd className="text-foreground">{selectedService.cpu}</dd>
                </div>
                <div>
                  <dt className="text-muted-foreground mb-1">Memory</dt>
                  <dd className="text-foreground">{selectedService.memory} MB</dd>
                </div>
                <div className="col-span-2">
                  <dt className="text-muted-foreground mb-1">Endpoint URL</dt>
                  <dd className="text-foreground">
                    {selectedService.endpointUrl ? (
                      <a
                        href={selectedService.endpointUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-primary hover:underline"
                      >
                        {selectedService.endpointUrl}
                      </a>
                    ) : (
                      <span className="text-muted-foreground">Not available</span>
                    )}
                  </dd>
                </div>
              </dl>
            </div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="h-full flex flex-col bg-[rgb(var(--semantic-0))]">
      <div className="flex-1 min-h-0 overflow-y-auto px-10">
        <div className="max-w-[1024px] w-full mx-auto flex flex-col gap-8 pt-10 pb-6">
          {/* Services Section */}
          <div className="flex flex-col gap-4">
            <div className="flex flex-col gap-1">
              <h1 className="text-2xl font-medium text-foreground leading-8">Services</h1>
              <p className="text-sm leading-5 text-muted-foreground">
                Deploy and manage long-running containers on your infrastructure.
              </p>
            </div>

            {services.length === 0 ? (
              <div className="bg-card border border-[var(--alpha-8)] rounded-lg p-8 text-center">
                <p className="text-sm text-muted-foreground mb-2">No services deployed yet.</p>
                <p className="text-xs text-muted-foreground">
                  Create a service using the CLI:{' '}
                  <code className="px-1.5 py-0.5 bg-muted rounded text-xs">
                    insforge compute services create
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
    </div>
  );
}
