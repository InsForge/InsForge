import { ExternalLink } from 'lucide-react';
import type { ServiceSchema } from '@insforge/shared-schemas';
import { statusColors } from '../constants';

interface ServiceCardProps {
  service: ServiceSchema;
  onClick: () => void;
}

export function ServiceCard({ service, onClick }: ServiceCardProps) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="w-full text-left bg-card border border-[var(--alpha-8)] rounded-lg p-4 hover:border-foreground/20 transition-colors cursor-pointer"
    >
      <div className="flex items-center justify-between mb-3">
        <h3 className="text-sm font-medium text-foreground truncate">{service.name}</h3>
        <span className="flex items-center gap-1.5 text-xs text-muted-foreground">
          <span className={`inline-block h-2 w-2 rounded-full ${statusColors[service.status]}`} />
          {service.status}
        </span>
      </div>

      <p className="text-xs text-muted-foreground truncate mb-3" title={service.imageUrl}>
        {service.imageUrl}
      </p>

      {service.endpointUrl && (
        <a
          href={service.endpointUrl}
          target="_blank"
          rel="noopener noreferrer"
          onClick={(e) => e.stopPropagation()}
          className="inline-flex items-center gap-1 text-xs text-primary hover:underline mb-3"
        >
          <ExternalLink className="h-3 w-3" />
          {service.endpointUrl}
        </a>
      )}

      <div className="flex items-center gap-3 text-xs text-muted-foreground pt-2 border-t border-[var(--alpha-8)]">
        <span>CPU: {service.cpu}</span>
        <span>Memory: {service.memory} MB</span>
      </div>
    </button>
  );
}
